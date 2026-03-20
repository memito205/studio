
"use server";

import { firestore } from "@/services/firebase";
import { runTransaction, collection, query, where, limit, getDocs, doc, setDoc } from 'firebase/firestore';
import type { ScannedItem } from "@/types";

// This file is obsolete and its content has been merged into src/app/reception/actions.ts
// It is left empty to avoid breaking any potential leftover imports.
    
