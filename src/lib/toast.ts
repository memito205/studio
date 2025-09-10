import { toast, type Toast } from '@/hooks/use-toast';

export const showSuccess = (message: string, description?: string) => {
  toast({
    title: message,
    description: description,
  });
};

export const showError = (message: string, description?: string) => {
  toast({
    variant: 'destructive',
    title: message,
    description: description,
  });
};

// Returns the ID of the toast to be dismissed later
export const showLoading = (message: string): string => {
  const { id } = toast({
    title: message,
    description: 'Por favor, espere...',
  });
  return id;
};

export const dismissToast = (toastId: string) => {
  toast({
    id: toastId, // This seems to be how our custom hook is designed to dismiss
  }).dismiss();
};

export const updateToast = (toastId: string, props: Toast) => {
    toast({
        id: toastId,
        ...props,
    }).update({
        id: toastId,
        ...props
    });
}
