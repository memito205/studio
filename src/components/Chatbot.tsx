
"use client";
import React from 'react';

export const Chatbot = (props: any) => {
    if (!props.isOpen) return null;
    return <div style={{ position: 'fixed', bottom: 20, right: 20, width: 300, height: 400, border: '1px solid black', backgroundColor: 'white', zIndex: 1000 }}>Chatbot</div>;
}
