'use client';

import { useSyncExternalStore } from 'react';
import { subscribeMarketActivity, getMarketActivity, getServerMarketActivity } from '@/utils/market-lifecycle';

export default function useMarketActivity() {
    return useSyncExternalStore(subscribeMarketActivity, getMarketActivity, getServerMarketActivity);
}
