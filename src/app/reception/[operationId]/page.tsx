
"use client";
import { ReceptionReadingScreen } from "@/components/ReceptionReadingScreen";
import { useRouter } from "next/navigation";

export default function ReadingPage({ params }: { params: { operationId: string } }) {
  const router = useRouter();
  
  if (!params.operationId) {
    return <div>Cargando...</div>;
  }

  return (
    <ReceptionReadingScreen
      operationId={params.operationId}
      onReturnToOperations={() => router.push('/reception')}
    />
  );
}
