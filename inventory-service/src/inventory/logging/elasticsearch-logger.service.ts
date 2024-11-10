import { Injectable, LoggerService, Inject } from '@nestjs/common';
import * as winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

@Injectable()
export class ElasticsearchLoggerService implements LoggerService {
  private readonly logger: winston.Logger;

  constructor(
    @Inject('ELASTICSEARCH_HOST') private readonly elasticsearchHost: string,
  ) {
    const esTransport = new ElasticsearchTransport({
      level: 'info',
      clientOpts: { node: elasticsearchHost },
    });

    this.logger = winston.createLogger({
      transports: [esTransport],
    });
  }

  log(message: string, context?: string) {
    this.logger.info({ message, context });
  }

  error(message: string, trace: string, context?: string) {
    this.logger.error({ message, trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn({ message, context });
  }

  debug(message: string, context?: string) {
    this.logger.debug({ message, context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose({ message, context });
  }
}
