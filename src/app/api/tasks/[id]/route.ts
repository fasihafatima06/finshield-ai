import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';

export async function GET(
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

    const events = store.getTaskEvents(task.id);
    const extractedFields = store.getExtractedFields(task.id);
    const securityFindings = store.getSecurityFindings(task.id);
    const evaluationResult = store.getEvaluationResult(task.id);
    const humanReviews = store.getHumanReviews(task.id);
    const sandboxExecution = store.getSandboxExecution(task.id);

    return NextResponse.json({
      success: true,
      data: {
        task,
        events,
        extractedFields,
        securityFindings,
        evaluationResult,
        humanReviews,
        sandboxExecution,
        convertedCsv: store.getTaskConvertedCsv(task.id),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to retrieve task' },
      { status: 500 }
    );
  }
}
