import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AgentModule } from '../agent/agent.module';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
  imports: [AgentModule],
})
export class ChatModule {}
