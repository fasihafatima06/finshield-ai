import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';

export async function GET() {
  try {
    const policies = store.getAllPolicyRules();
    return NextResponse.json({
      success: true,
      data: policies,
      total: policies.length,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch policies' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, is_active, ...updates } = body;

    if (id) {
      // Toggle or update existing rule
      const updated = store.updatePolicyRule(id, {
        ...(is_active !== undefined ? { is_active } : {}),
        ...updates,
      });

      if (!updated) {
        return NextResponse.json({ success: false, error: 'Policy rule not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        data: updated,
        message: `Policy rule "${updated.name}" updated`,
      });
    }

    // Create new rule
    const newRule = store.savePolicyRule({
      name: updates.name || 'New Policy Rule',
      description: updates.description || 'Custom banking policy rule',
      category: updates.category || 'security',
      rule_type: updates.rule_type || 'mandatory',
      conditions: updates.conditions || {},
      action: updates.action || 'verify',
      is_active: is_active ?? true,
      version: '1.0.0',
      updated_by: 'compliance-admin',
    });

    return NextResponse.json({
      success: true,
      data: newRule,
      message: 'New policy rule created',
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update policy' },
      { status: 500 }
    );
  }
}
