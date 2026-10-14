import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';
import { processTask } from '@/lib/engine/pipeline';

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

    // Trigger processing
    await processTask(task.id);
    const updatedTask = store.getTask(task.id);

    return NextResponse.json({
      success: true,
      data: updatedTask,
      message: `Task ${task.task_number} processed successfully`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}
