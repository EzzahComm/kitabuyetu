import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldValues, type UseFormProps } from 'react-hook-form';
import type { z } from 'zod';

export function useZodForm<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  options: Omit<UseFormProps<TInput, unknown, TOutput>, 'resolver'> = {},
) {
  return useForm<TInput, unknown, TOutput>({
    ...options,
    resolver: zodResolver<TInput, unknown, TOutput>(schema),
  });
}
