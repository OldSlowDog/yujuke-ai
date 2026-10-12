import { Module } from '@nestjs/common';
import { WhitelistGuard } from './auth.guard';

@Module({
  providers: [WhitelistGuard],
  exports: [WhitelistGuard],
})
export class AuthModule {}
