import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';

const PROTO_PATH = join(process.cwd(), 'proto');

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'INFERENCE_PACKAGE',
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            package: 'inference',
            protoPath: join(PROTO_PATH, 'inference.proto'),
            url: process.env.GRPC_INFERENCE_URL ?? 'localhost:50051',
          },
        }),
      },
      {
        name: 'TOOLS_PACKAGE',
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            package: 'tools',
            protoPath: join(PROTO_PATH, 'tools.proto'),
            url: process.env.GRPC_TOOLS_URL ?? 'localhost:50052',
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class GrpcModule {}
