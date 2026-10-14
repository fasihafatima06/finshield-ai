import { NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';

export async function GET() {
  try {
    const metrics = store.getDashboardMetrics();
    const allTasks = store.getAllTasks();

    // Additional breakdown metrics
    const decisionsCount = {
      ALLOW: allTasks.filter(t => t.decision === 'ALLOW').length,
      BLOCK: allTasks.filter(t => t.decision === 'BLOCK').length,
      VERIFY: allTasks.filter(t => t.decision === 'VERIFY' || t.state === 'awaiting_review').length,
    };

    const riskDistribution = {
      low: allTasks.filter(t => t.risk_score !== null && t.risk_score < 30).length,
      medium: allTasks.filter(t => t.risk_score !== null && t.risk_score >= 30 && t.risk_score < 60).length,
      high: allTasks.filter(t => t.risk_score !== null && t.risk_score >= 60 && t.risk_score < 85).length,
      critical: allTasks.filter(t => t.risk_score !== null && t.risk_score >= 85).length,
    };

    const taskTypeDistribution = {
      invoice_verification: allTasks.filter(t => t.type === 'invoice_verification').length,
      vendor_verification: allTasks.filter(t => t.type === 'vendor_verification').length,
      payment_preparation: allTasks.filter(t => t.type === 'payment_preparation').length,
      account_reconciliation: allTasks.filter(t => t.type === 'account_reconciliation').length,
      document_review: allTasks.filter(t => t.type === 'document_review').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        ...metrics,
        decisionsCount,
        riskDistribution,
        taskTypeDistribution,
        totalAllTime: allTasks.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
