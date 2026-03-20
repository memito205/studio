
"use client";

import React from 'react';
import { RoutesModule } from '@/components/RoutesModule';
import AuthLayout from '@/components/AuthLayout';
import { useRouter } from 'next/navigation';

export default function RoutesPage() {
    const router = useRouter();

    return (
        <AuthLayout>
            <RoutesModule onReturnToSuite={() => router.push('/')} />
        </AuthLayout>
    );
}
