import { z } from 'zod'

export const UpdateSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
  })
  .strict()

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>
