/**
 * ParamHandler — 파라미터 조회/설정 추상화
 */
class ParamHandler {
  constructor(client) {
    this.client = client;
  }

  get(paramName) {
    return this.client.callService('/rosapi/get_param', 'rosapi/GetParam', { name: paramName });
  }

  set(paramName, value) {
    return this.client.callService('/rosapi/set_param', 'rosapi/SetParam', {
      name: paramName,
      value: JSON.stringify(value),
    });
  }

  getAll() {
    return this.client.callService('/rosapi/get_param_names', 'rosapi/GetParamNames');
  }
}
