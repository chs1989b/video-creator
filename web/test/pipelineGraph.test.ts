import { test, expect } from 'vitest';
import {
  OPTIONAL_NODES, hiddenNodeIds, pipelineEdges, canToggle, presentFromJob, type OptionalNode,
} from '../lib/pipelineGraph';
import type { Job } from '../lib/workerApi';

const all = new Set<OptionalNode>(OPTIONAL_NODES);
const pairs = (present: Set<OptionalNode>) => pipelineEdges(present).map((e) => `${e.source}>${e.target}`);

const st = (status: string) => ({ status, outputPath: null, error: null }) as Job['stages']['generate'];
const job = (patch: Partial<Job> = {}, stages: Record<string, string> = {}): Job => ({
  id: 'job-1', youtubeUrl: 'u', characterImagePaths: ['/c.png'], productImagePaths: [], script: null,
  restylePrompt: null, editPrompt: null, status: 'idle', currentStage: null,
  stages: {
    generate: st('pending'), merge: st('pending'), restyle: st('skipped'), edit: st('skipped'), voiceover: st('skipped'),
    ...Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, st(v)])),
  } as Job['stages'],
  segments: [], resultPath: null, error: null, createdAt: '',
  previewRequired: true, mock: false, previewLimit: 5, attempts: [], approvedAttemptId: null,
  ...patch,
});

test('with every optional node the pipeline runs merge → restyle → edit → voiceover → result', () => {
  const edges = pairs(all);
  expect(edges).toEqual(expect.arrayContaining([
    'video>preview', 'person>preview', 'product>preview', 'preview>generate', 'generate>merge',
    'merge>restyle', 'restyle>edit', 'edit>voiceover', 'voiceover>result',
    'restyle-prompt>restyle', 'edit-prompt>edit', 'script>voiceover',
  ]));
  expect(hiddenNodeIds(all).size).toBe(0);
});

test('removing optional stages reconnects the chain around them and hides their prompt cards', () => {
  const present = new Set<OptionalNode>(['voiceover']);
  const edges = pairs(present);
  expect(edges).toContain('merge>voiceover');
  expect(edges).toContain('voiceover>result');
  expect(edges.some((e) => e.includes('restyle') || e.includes('edit'))).toBe(false);
  expect(edges).not.toContain('product>preview');
  expect([...hiddenNodeIds(present)].sort()).toEqual(['edit', 'edit-prompt', 'product', 'restyle', 'restyle-prompt']);

  expect(pairs(new Set())).toContain('merge>result');
});

test('optional nodes can be added or removed before a job exists, and stages again after approval until they run', () => {
  for (const node of OPTIONAL_NODES) expect(canToggle(null, node)).toBe(true);

  const waiting = job();
  expect(canToggle(waiting, 'voiceover')).toBe(false); // preview not approved yet
  expect(canToggle(waiting, 'product')).toBe(false); // the product photo is part of the job

  const approved = job({ approvedAttemptId: 'a1' });
  expect(canToggle(approved, 'voiceover')).toBe(true);
  expect(canToggle(approved, 'product')).toBe(false);

  const editDone = job({ approvedAttemptId: 'a1' }, { generate: 'done', merge: 'done', edit: 'done' });
  expect(canToggle(editDone, 'edit')).toBe(false);
  expect(canToggle(editDone, 'restyle')).toBe(false); // a later stage already ran
  expect(canToggle(editDone, 'voiceover')).toBe(true);
});

test('a saved job reopens with the nodes it uses, plus any stage that can still be added', () => {
  const saved = job({ script: 'Hi.', productImagePaths: ['/p.png'] }, { voiceover: 'pending' });
  expect([...presentFromJob(saved)].sort()).toEqual(['product', 'voiceover']);

  const approved = job({ approvedAttemptId: 'a1' });
  expect([...presentFromJob(approved)].sort()).toEqual(['edit', 'restyle', 'voiceover']);
});

import { optionalNodeOf, dropPlacement } from '../lib/pipelineGraph';

test('optionalNodeOf maps any card of an optional node back to that node', () => {
  expect(optionalNodeOf('product')).toBe('product');
  expect(optionalNodeOf('restyle-prompt')).toBe('restyle');
  expect(optionalNodeOf('script')).toBe('voiceover');
  expect(optionalNodeOf('voiceover')).toBe('voiceover');
  expect(optionalNodeOf('person')).toBeNull();
  expect(optionalNodeOf('merge')).toBeNull();
});

test('dropPlacement puts the stage where it was dropped and its prompt card above it', () => {
  expect(dropPlacement('product', { x: 100, y: 200 })).toEqual({ product: { x: 100, y: 200 } });
  expect(dropPlacement('edit', { x: 500, y: 400 })).toEqual({
    edit: { x: 500, y: 400 },
    'edit-prompt': { x: 500, y: 140 },
  });
});
