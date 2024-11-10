import { Injectable, Inject } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

@Injectable()
export class ElasticsearchLoggerService {
  private readonly client: Client;

  constructor(
    @Inject('ELASTICSEARCH_HOST') private readonly elasticsearchHost: string,
  ) {
    this.client = new Client({ node: elasticsearchHost });
  }

  async logOrderEvent(eventType: string, data: any) {
    try {
      await this.client.index({
        index: 'order-logs',
        document: {
          timestamp: new Date(),
          eventType,
          data,
        },
      });
    } catch (error) {
      console.error('Error logging to Elasticsearch:', error);
    }
  }
}
