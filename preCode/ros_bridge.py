import rclpy
from rclpy.node import Node
from sensor_msgs.msg import PointCloud2, CompressedImage
from nav_msgs.msg import Odometry
import sensor_msgs_py.point_cloud2 as pc2
import asyncio
import websockets
import json
import numpy as np
import threading
import time
import subprocess
import os
from datetime import datetime

PC_PORT   = 9090
CAM_PORT  = 9091
META_PORT = 9092
CMD_PORT  = 9093

SAVE_DIR = os.path.expanduser('~/slam_saves')
os.makedirs(SAVE_DIR, exist_ok=True)

VOXEL_SIZE  = 0.05   # 시각화 다운샘플 (5cm)
MAX_VIS_PTS = 15000

# 확인된 실제 토픽
VIS_TOPIC  = '/glim_ros/aligned_points_corrected'  # loop closure 적용 시각화
MAP_TOPIC  = '/glim_ros/map'                        # 전체 맵 (저장용)
ODOM_TOPIC = '/glim_ros/odom_corrected'             # 보정 오도메트리


class SensorBridge(Node):
    def __init__(self):
        super().__init__('sensor_bridge')

        # 시각화용 (loop closure 적용 스캔)
        self.pc_sub = self.create_subscription(
            PointCloud2, VIS_TOPIC, self.pc_callback, 10)

        # 전체 맵 (저장용)
        self.map_sub = self.create_subscription(
            PointCloud2, MAP_TOPIC, self.map_callback, 10)

        # 카메라
        self.cam_sub = self.create_subscription(
            CompressedImage,
            '/zed/zed_node/rgb/image_rect_color/compressed',
            self.cam_callback, 10)

        # 오도메트리 (메타 표시용)
        self.odom_sub = self.create_subscription(
            Odometry, ODOM_TOPIC, self.odom_callback, 10)

        self.latest_vis_points = []
        self.latest_full_map   = None   # numpy Nx3
        self.map_lock          = threading.Lock()
        self.latest_frame      = None

        # 오도메트리 최신값
        self.latest_odom = {'x': 0.0, 'y': 0.0, 'z': 0.0}

        self.pc_clients   = set()
        self.cam_clients  = set()
        self.meta_clients = set()
        self.cmd_clients  = set()
        self.ws_loop = None

        self.topic_stats = {
            VIS_TOPIC: {
                'count': 0, 'hz': 0.0, 'last_time': time.time(),
                'msg_size': 0, 'last_value': '-'},
            MAP_TOPIC: {
                'count': 0, 'hz': 0.0, 'last_time': time.time(),
                'msg_size': 0, 'last_value': '-'},
            ODOM_TOPIC: {
                'count': 0, 'hz': 0.0, 'last_time': time.time(),
                'msg_size': 0, 'last_value': '-'},
            '/zed/zed_node/rgb/image_rect_color/compressed': {
                'count': 0, 'hz': 0.0, 'last_time': time.time(),
                'msg_size': 0, 'last_value': '-'},
        }

        self.bag_process    = None
        self.bag_start_time = None
        self.bag_filename   = None

        self.create_timer(1.0, self.publish_meta)
        self.get_logger().info(f'Sensor Bridge 시작 — 저장 경로: {SAVE_DIR}')

    # ─── 통계 ───
    def update_stats(self, topic, msg_size, last_value):
        if topic not in self.topic_stats:
            return
        s = self.topic_stats[topic]
        now = time.time()
        elapsed = now - s['last_time']
        s['count'] += 1
        if elapsed >= 1.0:
            s['hz']        = round(s['count'] / elapsed, 1)
            s['count']     = 0
            s['last_time'] = now
        s['msg_size']   = msg_size
        s['last_value'] = last_value

    # ─── Voxel grid 다운샘플 ───
    @staticmethod
    def voxel_downsample(pts_np, voxel_size):
        if len(pts_np) == 0:
            return pts_np
        idx  = np.floor(pts_np / voxel_size).astype(np.int32)
        keys = (idx[:, 0].astype(np.int64) * 1_000_003 +
                idx[:, 1].astype(np.int64) * 1_009 +
                idx[:, 2].astype(np.int64))
        _, uniq = np.unique(keys, return_index=True)
        return pts_np[uniq]

    # ─── 콜백: 시각화용 스캔 ───
    def pc_callback(self, msg):
        raw = np.array([
            [p[0], p[1], p[2]]
            for p in pc2.read_points(msg, field_names=('x','y','z'),
                                     skip_nans=True)
        ], dtype=np.float32)

        if len(raw) == 0:
            return

        down = self.voxel_downsample(raw, VOXEL_SIZE)
        if len(down) > MAX_VIS_PTS:
            idx  = np.random.choice(len(down), MAX_VIS_PTS, replace=False)
            down = down[idx]

        pts = [[round(float(p[0]),3), round(float(p[1]),3), round(float(p[2]),3)]
               for p in down]
        self.latest_vis_points = pts

        self.update_stats(VIS_TOPIC, len(raw) * 12,
                          f'{len(raw):,} pts → {len(pts):,} vis')

        if self.pc_clients and self.ws_loop:
            asyncio.run_coroutine_threadsafe(
                self.broadcast(self.pc_clients,
                               json.dumps({'points': pts}), False),
                self.ws_loop)

    # ─── 콜백: 전체 맵 (저장용) ───
    def map_callback(self, msg):
        raw = np.array([
            [p[0], p[1], p[2]]
            for p in pc2.read_points(msg, field_names=('x','y','z'),
                                     skip_nans=True)
        ], dtype=np.float32)

        with self.map_lock:
            self.latest_full_map = raw

        self.update_stats(MAP_TOPIC, len(raw) * 12,
                          f'{len(raw):,} pts')

    # ─── 콜백: 오도메트리 ───
    def odom_callback(self, msg):
        p = msg.pose.pose.position
        self.latest_odom = {
            'x': round(float(p.x), 2),
            'y': round(float(p.y), 2),
            'z': round(float(p.z), 2),
        }
        val = f'x:{self.latest_odom["x"]} y:{self.latest_odom["y"]} z:{self.latest_odom["z"]}'
        self.update_stats(ODOM_TOPIC, 0, val)

    # ─── 콜백: 카메라 ───
    def cam_callback(self, msg):
        self.latest_frame = bytes(msg.data)
        size_kb = round(len(self.latest_frame) / 1024, 1)
        self.update_stats(
            '/zed/zed_node/rgb/image_rect_color/compressed',
            len(self.latest_frame), f'{size_kb} KB')
        if self.cam_clients and self.ws_loop:
            asyncio.run_coroutine_threadsafe(
                self.broadcast(self.cam_clients, self.latest_frame, True),
                self.ws_loop)

    # ─── 저장: 포인트 선택 ───
    def _get_save_points(self):
        """
        1순위: /glim_ros/map (전체 맵, loop closure 적용)
        2순위: latest_vis_points (fallback)
        """
        with self.map_lock:
            if self.latest_full_map is not None and len(self.latest_full_map) > 0:
                return self.latest_full_map.tolist(), 'full_map'
        if self.latest_vis_points:
            return self.latest_vis_points, 'vis_only(degraded)'
        return None, 'empty'

    def save_pcd(self):
        pts, src = self._get_save_points()
        if not pts:
            return None, 'points 없음'
        ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'map_{ts}.pcd'
        filepath = os.path.join(SAVE_DIR, filename)
        n = len(pts)
        with open(filepath, 'w') as f:
            f.write(f'# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\n'
                    f'SIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n'
                    f'WIDTH {n}\nHEIGHT 1\n'
                    f'VIEWPOINT 0 0 0 1 0 0 0\nPOINTS {n}\nDATA ascii\n')
            for p in pts:
                f.write(f'{p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n')
        size_kb = round(os.path.getsize(filepath) / 1024, 1)
        self.get_logger().info(f'PCD [{src}]: {filepath}')
        return filename, f'{n:,} pts · {size_kb} KB [{src}]'

    def save_ply(self):
        pts, src = self._get_save_points()
        if not pts:
            return None, 'points 없음'
        ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'map_{ts}.ply'
        filepath = os.path.join(SAVE_DIR, filename)
        n = len(pts)
        with open(filepath, 'w') as f:
            f.write(f'ply\nformat ascii 1.0\nelement vertex {n}\n'
                    f'property float x\nproperty float y\nproperty float z\n'
                    f'end_header\n')
            for p in pts:
                f.write(f'{p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n')
        size_kb = round(os.path.getsize(filepath) / 1024, 1)
        self.get_logger().info(f'PLY [{src}]: {filepath}')
        return filename, f'{n:,} pts · {size_kb} KB [{src}]'

    # ─── rosbag ───
    def bag_start(self, topics=None):
        if self.bag_process and self.bag_process.poll() is None:
            return False, '이미 녹화 중'
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.bag_filename = f'bag_{ts}'
        bag_path = os.path.join(SAVE_DIR, self.bag_filename)
        default_topics = [
            VIS_TOPIC,
            MAP_TOPIC,
            ODOM_TOPIC,
            '/glim_ros/odom',
            '/glim_ros/pose_corrected',
            '/zed/zed_node/rgb/image_rect_color/compressed',
            '/livox/lidar',
            '/livox/imu',
        ]
        cmd = ['ros2', 'bag', 'record', '-o', bag_path] + (topics or default_topics)
        self.bag_process    = subprocess.Popen(cmd)
        self.bag_start_time = time.time()
        self.get_logger().info(f'rosbag 시작: {bag_path}')
        return True, self.bag_filename

    def bag_stop(self):
        if not self.bag_process or self.bag_process.poll() is not None:
            return False, '녹화 중이 아님'
        self.bag_process.terminate()
        self.bag_process.wait()
        filename = self.bag_filename
        elapsed  = round(time.time() - self.bag_start_time, 1)
        self.bag_process    = None
        self.bag_start_time = None
        self.bag_filename   = None
        return True, f'{filename} ({elapsed}s)'

    def bag_is_recording(self):
        return self.bag_process is not None and self.bag_process.poll() is None

    # ─── 파일 목록 ───
    def list_saves(self):
        files = []
        for fname in sorted(os.listdir(SAVE_DIR), reverse=True):
            fpath = os.path.join(SAVE_DIR, fname)
            if os.path.isfile(fpath):
                size_kb = round(os.path.getsize(fpath) / 1024, 1)
                ext = fname.rsplit('.', 1)[-1] if '.' in fname else 'bin'
                files.append({
                    'name': fname, 'size': f'{size_kb} KB', 'ext': ext,
                    'time': datetime.fromtimestamp(
                        os.path.getmtime(fpath)).strftime('%Y-%m-%d %H:%M:%S'),
                    'downloadable': True,
                })
            elif os.path.isdir(fpath) and fname.startswith('bag_'):
                total = sum(
                    os.path.getsize(os.path.join(fpath, fn))
                    for fn in os.listdir(fpath)
                    if os.path.isfile(os.path.join(fpath, fn))
                )
                files.append({
                    'name': fname,
                    'size': f'{round(total/1024/1024, 1)} MB',
                    'ext':  'bag',
                    'time': datetime.fromtimestamp(
                        os.path.getmtime(fpath)).strftime('%Y-%m-%d %H:%M:%S'),
                    'downloadable': False,
                })
        return files

    # ─── CMD 핸들러 ───
    async def cmd_handler(self, websocket):
        self.cmd_clients.add(websocket)
        await websocket.send(json.dumps({'type': 'history', 'files': self.list_saves()}))
        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                    cmd = msg.get('cmd')

                    if cmd == 'save_pcd':
                        filename, info = self.save_pcd()
                        ok = filename is not None
                        await websocket.send(json.dumps({
                            'type': 'save_result', 'ok': ok,
                            'filename': filename, 'info': info, 'ext': 'pcd'}))
                        if ok:
                            await websocket.send(json.dumps(
                                {'type': 'history', 'files': self.list_saves()}))

                    elif cmd == 'save_ply':
                        filename, info = self.save_ply()
                        ok = filename is not None
                        await websocket.send(json.dumps({
                            'type': 'save_result', 'ok': ok,
                            'filename': filename, 'info': info, 'ext': 'ply'}))
                        if ok:
                            await websocket.send(json.dumps(
                                {'type': 'history', 'files': self.list_saves()}))

                    elif cmd == 'bag_start':
                        ok, info = self.bag_start()
                        await websocket.send(json.dumps({
                            'type': 'bag_status',
                            'recording': self.bag_is_recording(),
                            'ok': ok, 'info': info}))

                    elif cmd == 'bag_stop':
                        ok, info = self.bag_stop()
                        await websocket.send(json.dumps({
                            'type': 'bag_status', 'recording': False,
                            'ok': ok, 'info': info}))
                        if ok:
                            await websocket.send(json.dumps(
                                {'type': 'history', 'files': self.list_saves()}))

                    elif cmd == 'list':
                        await websocket.send(json.dumps(
                            {'type': 'history', 'files': self.list_saves()}))

                except Exception as e:
                    self.get_logger().error(f'CMD 오류: {e}')
        finally:
            self.cmd_clients.discard(websocket)

    # ─── 메타 브로드캐스트 ───
    def publish_meta(self):
        if not self.meta_clients or not self.ws_loop:
            return
        with self.map_lock:
            map_pts = len(self.latest_full_map) if self.latest_full_map is not None else 0

        payload = {
            'type': 'meta',
            'topics': [
                {'name': t, 'hz': s['hz'], 'msg_size': s['msg_size'],
                 'last_value': s['last_value']}
                for t, s in self.topic_stats.items()
            ],
            'bag_recording': self.bag_is_recording(),
            'bag_elapsed':   round(time.time() - self.bag_start_time, 0)
                             if self.bag_is_recording() else 0,
            'map_pts':  map_pts,
            'odom':     self.latest_odom,
        }
        asyncio.run_coroutine_threadsafe(
            self.broadcast(self.meta_clients, json.dumps(payload), False),
            self.ws_loop)

    async def broadcast(self, clients, data, binary=False):
        dead = set()
        for c in clients:
            try:
                await c.send(data)
            except:
                dead.add(c)
        clients -= dead

    async def pc_handler(self, websocket):
        self.pc_clients.add(websocket)
        try:
            if self.latest_vis_points:
                await websocket.send(json.dumps({'points': self.latest_vis_points}))
            await websocket.wait_closed()
        finally:
            self.pc_clients.discard(websocket)

    async def cam_handler(self, websocket):
        self.cam_clients.add(websocket)
        try:
            if self.latest_frame:
                await websocket.send(self.latest_frame)
            await websocket.wait_closed()
        finally:
            self.cam_clients.discard(websocket)

    async def meta_handler(self, websocket):
        self.meta_clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.meta_clients.discard(websocket)

    async def run_servers(self):
        async with (
            websockets.serve(self.pc_handler,   '0.0.0.0', PC_PORT),
            websockets.serve(self.cam_handler,  '0.0.0.0', CAM_PORT),
            websockets.serve(self.meta_handler, '0.0.0.0', META_PORT),
            websockets.serve(self.cmd_handler,  '0.0.0.0', CMD_PORT),
        ):
            self.get_logger().info('PC:9090 CAM:9091 META:9092 CMD:9093')
            await asyncio.Future()

    def start_websocket(self):
        self.ws_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.ws_loop)
        self.ws_loop.run_until_complete(self.run_servers())


def main():
    rclpy.init()
    node = SensorBridge()
    ws_thread = threading.Thread(target=node.start_websocket, daemon=True)
    ws_thread.start()
    rclpy.spin(node)
    rclpy.shutdown()

if __name__ == '__main__':
    main()