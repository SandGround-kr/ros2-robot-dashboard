/**
 * ServiceHandler — 서비스 호출 추상화
 */
class ServiceHandler {
  constructor(client) {
    this.client = client;
  }

  call(serviceName, serviceType, request = {}) {
    return this.client.callService(serviceName, serviceType, request);
  }

  getNodes() {
    return this.client.getNodes();
  }

  getTopics() {
    return this.client.getTopics();
  }

  getTopicType(topicName) {
    return this.client.callService('/rosapi/topic_type', 'rosapi/TopicType', { topic: topicName });
  }

  getServiceType(serviceName) {
    return this.client.callService('/rosapi/service_type', 'rosapi/ServiceType', { service: serviceName });
  }
}
