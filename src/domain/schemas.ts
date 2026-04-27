import { z } from "zod";

export const dateString = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const issueSearchSchema = z.object({
  query: z.string().trim().optional(),
  team: z.string().trim().optional(),
  assignee: z.string().trim().optional(),
  status: z.string().trim().optional(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  project: z.string().trim().optional(),
  createdAfter: dateString.optional(),
  createdBefore: dateString.optional(),
  updatedAfter: dateString.optional(),
  updatedBefore: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z.string().optional()
});

export const issueCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  team: z.string().trim().optional(),
  status: z.string().trim().optional(),
  assignee: z.string().trim().optional(),
  project: z.string().trim().optional(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  labels: z.array(z.string().trim().min(1)).default([]),
  parent: z.string().trim().optional()
});

export const issueUpdateSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  status: z.string().trim().optional(),
  assignee: z.string().trim().nullable().optional(),
  project: z.string().trim().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  labels: z.array(z.string().trim().min(1)).optional(),
  parent: z.string().trim().nullable().optional()
});

export const commentAddSchema = z.object({
  issue: z.string().trim().min(1),
  body: z.string().trim().min(1)
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  content: z.string().optional(),
  teams: z.array(z.string().trim().min(1)).min(1),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  state: z.string().trim().optional()
});

export type IssueSearchInput = z.infer<typeof issueSearchSchema>;
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type IssueUpdateInput = z.infer<typeof issueUpdateSchema>;
export type CommentAddInput = z.infer<typeof commentAddSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
