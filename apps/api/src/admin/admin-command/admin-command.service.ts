import { Injectable } from '@nestjs/common';
import { Command } from 'commander';
const prompts = require('prompts');
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AdminCommandService {
  constructor(private prisma: PrismaService) {}

  async run() {
    const program = new Command();
    program
      .name('admin:create')
      .description('Create a new admin user')
      .option('-e, --email <email>', 'Admin email address');

    program.parse(process.argv);
    const options = program.opts();

    let email = options.email;

    if (!email) {
      const response = await prompts({
        type: 'text',
        name: 'email',
        message: 'Enter admin email:',
        validate: (value: string) =>
          value.includes('@') ? true : 'Invalid email',
      });
      email = response.email;
    }

    if (!email) {
      console.log('Email is required.');
      return;
    }

    // Check if exists
    const existing = await this.prisma.adminUser.findUnique({
      where: { email },
    });

    if (existing) {
      console.log('Error: An admin with this email already exists.');
      return;
    }

    const { password } = await prompts({
      type: 'password',
      name: 'password',
      message: 'Enter a strong password:',
      validate: (value: string) =>
        value.length >= 8 ? true : 'Password must be at least 8 characters',
    });

    if (!password) {
      console.log('Password is required.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash,
      },
    });

    console.log(`\nSuccess: Admin ${email} created successfully.`);
  }
}
