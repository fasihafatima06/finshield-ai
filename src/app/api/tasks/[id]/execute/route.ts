import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';
import { executeSandboxTask } from '@/lib/engine/pipeline';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = store.getTask(id) || store.getTaskByNumber(id);

    if (!task) {
      return NextResponse.json(
        { success: false, error: `Task not found with ID ${id}` },
        { status: 404 }
      );
    }

    const execution = await executeSandboxTask(task.id);

    return NextResponse.json({
      success: true,
      data: {
        execution,
        task: store.getTask(task.id),
      },
      message: 'Sandbox transaction executed with simulated banking core',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Execution failed' },
      { status: 400 }
    );
  }
}
