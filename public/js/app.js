document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new Dashboard(document.getElementById('dashboard'));
  const manager = new RobotManager((robots) => {
    dashboard.render(robots, manager);
  });
});
