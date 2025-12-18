import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import Papa from 'papaparse';

export async function POST(request) {
    try {
        const { transactions } = await request.json();

        if (!transactions || !Array.isArray(transactions)) {
            return NextResponse.json({ error: 'Invalid transactions data' }, { status: 400 });
        }

        const filePath = path.join(process.cwd(), 'data', 'portfolio.csv');

        // Map app transactions back to the CSV headers
        // Header: Date,Way,Base amount,Base currency (name),Base type,Quote amount,Quote currency,Exchange,Sent/Received from,Sent to,Fee amount,Fee currency (name),Broker,Notes,Sync Base Holding,Leverage Metadata
        const csvRows = transactions.map(tx => {
            // Remove suffixes for CSV storage if they were added by processTransactions
            let symbol = tx.baseCurrency || '';
            if (tx.originalType === 'CRYPTO') symbol = symbol.replace('-USD', '');
            if (tx.originalType === 'FIAT' && symbol !== 'USD') symbol = symbol.replace('=X', '');

            return {
                'Date': new Date(tx.date).toLocaleDateString('en-GB').split('/').reverse().join('-'), // YYYY-MM-DD-ish or original format
                'Way': tx.type,
                'Base amount': tx.baseAmount,
                'Base currency (name)': symbol,
                'Base type': tx.originalType || 'MANUAL',
                'Quote amount': tx.quoteAmount,
                'Quote currency': tx.quoteCurrency,
                'Exchange': tx.exchange,
                'Fee amount': tx.fee || 0,
                'Fee currency (name)': tx.feeCurrency,
                'Notes': tx.notes || ''
            };
        });

        const csv = Papa.unparse(csvRows);
        fs.writeFileSync(filePath, csv);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Sync Error:', error);
        return NextResponse.json({ error: 'Failed to sync CSV' }, { status: 500 });
    }
}
