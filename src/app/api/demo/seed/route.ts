import { NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';

export async function POST() {
  try {
    store.resetDemoStore();
    store.seedDemoTasks();

    return NextResponse.json({
      success: true,
      message: 'Demo store reset and seeded with realistic banking operations data',
      data: {
        taskCount: store.getAllTasks().length,
        policyCount: store.getAllPolicyRules().length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to reseed store' },
      { status: 500 }
    );
  }
}
