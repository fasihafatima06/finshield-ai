import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/store/demo-store';
import { processTask } from '@/lib/engine/pipeline';
import { parseUploadedDocument } from '@/lib/engine/document-parser';
import { TASK_STATES, TASK_TYPES, ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedState = searchParams.get('state');
    const requestedDecision = searchParams.get('decision');
    const requestedType = searchParams.get('type');
    const state = TASK_STATES.includes(requestedState as (typeof TASK_STATES)[number])
      ? requestedState as (typeof TASK_STATES)[number]
      : undefined;
    const decision = ['ALLOW', 'BLOCK', 'VERIFY'].includes(requestedDecision || '')
      ? requestedDecision as 'ALLOW' | 'BLOCK' | 'VERIFY'
      : undefined;
    const type = TASK_TYPES.includes(requestedType as (typeof TASK_TYPES)[number])
      ? requestedType as (typeof TASK_TYPES)[number]
      : undefined;
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '50', 10) || 50));

    const result = store.getTasksFiltered({
      state,
      decision,
      type,
      search,
      page,
      pageSize,
    });

    return NextResponse.json({
      success: true,
      data: result.data.map((task) => {
        const execution = store.getSandboxExecution(task.id);
        return {
          ...task,
          execution_status: execution?.status ?? null,
          execution_reference: execution?.mock_reference_id ?? null,
        };
      }),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const isMultipart = request.headers.get('content-type')?.includes('multipart/form-data') || false;
    const body = isMultipart ? await request.formData() : await request.json();
    if (!body || typeof body !== 'object' || (!isMultipart && Array.isArray(body))) {
      return NextResponse.json({ success: false, error: 'A task object is required.' }, { status: 400 });
    }

    const getValue = (name: string): unknown => isMultipart
      ? (body as FormData).get(name)
      : (body as Record<string, unknown>)[name];
    const type = getValue('type');
    const title = getValue('title');
    const instructions = getValue('instructions');
    const reference_id = getValue('reference_id');
    const idempotencyKey = request.headers.get('Idempotency-Key');

    if (!TASK_TYPES.includes(type as (typeof TASK_TYPES)[number]) || typeof title !== 'string' || !title.trim() || title.length > 160) {
      return NextResponse.json(
        { success: false, error: 'Choose a valid task type and provide a title (maximum 160 characters).' },
        { status: 400 }
      );
    }
    if (instructions !== null && instructions !== undefined && (typeof instructions !== 'string' || instructions.length > 4000)) {
      return NextResponse.json({ success: false, error: 'Instructions must be 4,000 characters or fewer.' }, { status: 400 });
    }
    if (reference_id !== null && reference_id !== undefined && (typeof reference_id !== 'string' || reference_id.length > 100)) {
      return NextResponse.json({ success: false, error: 'Business reference must be 100 characters or fewer.' }, { status: 400 });
    }

    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > (isMultipart ? 120 : 128))) {
      return NextResponse.json(
        { success: false, error: `Idempotency-Key must be between 8 and ${isMultipart ? 120 : 128} characters.` },
        { status: 400 }
      );
    }

    if (isMultipart) {
      const files = (body as FormData).getAll('files');
      if (!files.length || files.length > 8 || files.some((file) => !(file instanceof File))) {
        return NextResponse.json({ success: false, error: 'Upload between 1 and 8 supported files per batch.' }, { status: 400 });
      }

      if (idempotencyKey) {
        const existingTasks = files.map((_, index) => store.getTaskByIdempotencyKey(`${idempotencyKey}:${index}`));
        if (existingTasks.every(Boolean)) {
          return NextResponse.json({ success: true, data: existingTasks, message: 'Existing tasks returned.' });
        }
        if (existingTasks.some(Boolean)) {
          return NextResponse.json({ success: false, error: 'This upload batch is partially recorded; use a new submission key.' }, { status: 409 });
        }
      }

      const parsedFiles = [];
      for (const item of files as File[]) {
        const fileName = item.name.replace(/^.*[\\/]/, '');
        const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
        if (
          fileName.length > 255 ||
          !ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number]) ||
          item.size < 1 || item.size > MAX_FILE_SIZE
        ) {
          return NextResponse.json({ success: false, error: `${fileName || 'A file'} is invalid or exceeds the supported 10 MB limit.` }, { status: 400 });
        }
        try {
          parsedFiles.push({ file: item, fileName, parsed: await parseUploadedDocument(item) });
        } catch (error) {
          return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : `Could not parse ${fileName}.` },
            { status: 400 }
          );
        }
      }

      const demoUser = store.getDemoUser();
      const tasks = parsedFiles.map(({ file, fileName, parsed }, index) => {
        const task = store.createTask({
          type: type as (typeof TASK_TYPES)[number],
          title: title.trim(),
          instructions: typeof instructions === 'string' && instructions.trim() ? instructions.trim() : null,
          submitter_id: demoUser.id,
          submitter_email: demoUser.email,
          file_name: fileName,
          file_size: file.size,
          file_type: file.type || mimeTypeForExtension(fileName),
          reference_id: typeof reference_id === 'string' && reference_id.trim()
            ? (parsedFiles.length > 1 ? `${reference_id.trim().slice(0, 95)}-${String(index + 1).padStart(2, '0')}` : reference_id.trim())
            : `REF-${Date.now().toString(36).toUpperCase()}-${index + 1}`,
          idempotency_key: idempotencyKey ? `${idempotencyKey}:${index}` : null,
        });
        store.saveTaskDocument(task.id, parsed.text, parsed.csv);
        store.addTaskEvent({
          task_id: task.id,
          event_type: 'task_submitted',
          actor: demoUser.full_name || demoUser.email,
          service: 'web-portal',
          correlation_id: `corr-${task.id.slice(0, 8)}`,
          details: { title: task.title, type, fileName, uploadBatchSize: parsedFiles.length, csvConverted: true },
        });
        processTask(task.id).catch((error) => {
          console.error(`Pipeline execution failed for task ${task.id}:`, error);
        });
        return task;
      });

      return NextResponse.json(
        { success: true, data: tasks, message: `${tasks.length} task(s) submitted for processing.` },
        { status: 201 }
      );
    }

    const file_name = getValue('file_name');
    const file_size = getValue('file_size');
    const file_type = getValue('file_type');
    if (idempotencyKey) {
      const existingTask = store.getTaskByIdempotencyKey(idempotencyKey);
      if (existingTask) return NextResponse.json({ success: true, data: existingTask, message: 'Existing task returned.' });
    }
    const hasFileMetadata = file_name !== undefined || file_size !== undefined || file_type !== undefined;
    if (hasFileMetadata) {
      const extension = typeof file_name === 'string' ? file_name.slice(file_name.lastIndexOf('.')).toLowerCase() : '';
      if (
        typeof file_name !== 'string' || file_name.length > 255 ||
        !ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number]) ||
        typeof file_size !== 'number' || !Number.isInteger(file_size) || file_size < 1 || file_size > MAX_FILE_SIZE ||
        typeof file_type !== 'string' || !ALLOWED_MIME_TYPES.includes(file_type as (typeof ALLOWED_MIME_TYPES)[number])
      ) {
        return NextResponse.json({ success: false, error: 'File metadata is invalid or exceeds the 10 MB demo limit.' }, { status: 400 });
      }
    }

    const demoUser = store.getDemoUser();
    const task = store.createTask({
      type: type as (typeof TASK_TYPES)[number],
      title: title.trim(),
      instructions: typeof instructions === 'string' ? instructions || null : null,
      submitter_id: demoUser.id,
      submitter_email: demoUser.email,
      file_name: typeof file_name === 'string' ? file_name : null,
      file_size: typeof file_size === 'number' ? file_size : null,
      file_type: typeof file_type === 'string' ? file_type : null,
      reference_id: typeof reference_id === 'string' && reference_id || `REF-${Date.now().toString(36).toUpperCase()}`,
      idempotency_key: idempotencyKey,
    });

    store.addTaskEvent({
      task_id: task.id,
      event_type: 'task_submitted',
      actor: demoUser.full_name || demoUser.email,
      service: 'web-portal',
      correlation_id: `corr-${task.id.slice(0, 8)}`,
      details: { title, type, fileName: typeof file_name === 'string' ? file_name : null },
    });

    const auto_process = getValue('auto_process') !== false;
    if (auto_process) {
      processTask(task.id).catch((err) => {
        console.error(`Pipeline execution failed for task ${task.id}:`, err);
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: task,
        message: 'Task submitted successfully to FinShield AI pipeline',
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}

function mimeTypeForExtension(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.csv') return 'text/csv';
  return 'text/plain';
}
