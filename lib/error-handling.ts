import toast from 'react-hot-toast'

export type ApiError = {
  message: string
  status?: number
  code?: string
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'An unexpected error occurred'
}

export function showErrorToast(error: unknown, fallbackMessage?: string): void {
  const message = getErrorMessage(error) || fallbackMessage || 'An error occurred'
  toast.error(message)
}

export function showSuccessToast(message: string): void {
  toast.success(message)
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const message = data.error || data.message || `Request failed (${response.status})`
    throw new Error(message)
  }
  return response.json()
}

export async function fetchWithErrorHandling<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(url, options)
    return await handleApiResponse<T>(response)
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error('Network error. Please check your connection.')
    }
    throw error
  }
}

export function createSafeAction<TInput, TOutput>(
  action: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<{ data?: TOutput; error?: string }> {
  return async (input: TInput) => {
    try {
      const data = await action(input)
      return { data }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  }
}
