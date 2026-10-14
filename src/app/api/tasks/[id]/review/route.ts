import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';
import type { ReviewDecision } from '@/lib/types';

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

    const body = await request.json();
    const { decision, notes } = body;

    if (!decision || !['approved', 'rejected', 'info_requested'].includes(decision)) {
      return NextResponse.json(
        { success: false, error: 'Valid review decision required: approved, rejected, info_requested' },
        { status: 400 }
      );
    }

    if (task.state !== 'awaiting_review' || task.decision !== 'VERIFY') {
      return NextResponse.json(
        { success: false, error: 'Only tasks awaiting human review can be reviewed.' },
        { status: 409 }
      );
    }

    if (typeof notes !== 'string' || notes.trim().length < 5 || notes.length > 2000) {
      return NextResponse.json(
        { success: false, error: 'Provide a review reason between 5 and 2,000 characters.' },
        { status: 400 }
      );
    }

    const demoUser = store.getDemoUser();
    const reviewerName = demoUser.full_name || demoUser.email;

    // Record human review
    const review = store.addHumanReview({
      task_id: task.id,
      reviewer_id: demoUser.id,
      reviewer_email: demoUser.email,
      decision: decision as ReviewDecision,
      reason: notes.trim(),
      policy_version: store.getEvaluationResult(task.id)?.policy_version || '1.0.0',
      previous_state: task.state,
    });

    // Update task state accordingly
    const nextState = decision === 'approved' ? 'allowed' : decision === 'rejected' ? 'blocked' : 'awaiting_review';
    const nextDecision = decision === 'rejected' ? 'BLOCK' : 'VERIFY';

    store.updateTask(task.id, { state: nextState, decision: nextDecision });

    store.addTaskEvent({
      task_id: task.id,
      event_type: decision === 'approved' ? 'review_approved' : decision === 'rejected' ? 'review_rejected' : 'review_info_requested',
      previous_state: task.state,
      next_state: nextState,
      actor: reviewerName,
      service: 'human-review-gate',
      correlation_id: `corr-rev-${Date.now().toString(36)}`,
      details: {
        decision,
        notes: notes.trim(),
        reviewId: review.id,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        review,
        task: store.getTask(task.id),
      },
      message: `Human review recorded: ${decision.toUpperCase()}`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Review submission failed' },
      { status: 500 }
    );
  }
}
