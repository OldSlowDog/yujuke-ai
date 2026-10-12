import { PrismaClient } from '@prisma/client';

/**
 * 脱敏种子数据：仅含演示用户与公开文档片段，**不含任何真实对话、密钥或凭证**。
 * 运行：npm run prisma:generate && npm run prisma:seed
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const demo = await prisma.user.upsert({
    where: { username: 'demo' },
    update: {},
    create: { username: 'demo' },
  });

  await prisma.knowledgeChunk.createMany({
    data: [
      { source: 'README.md', text: '隅居客：消费级硬件上的自托管私有 AI 助手' },
      { source: 'ARCHITECTURE.md', text: '混合边缘推理 + 云端反代架构' },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(`seed done: user=${demo.username}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
