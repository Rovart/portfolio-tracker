export function isPenceCurrency(currency) {
    const raw = String(currency || '').trim();
    return raw === 'GBp' || raw.toUpperCase() === 'GBX';
}

export function normalizeCurrency(currency) {
    return isPenceCurrency(currency) ? 'GBP' : currency;
}

export function scalePrice(value, currency) {
    if (value === null || value === undefined) return value;
    return isPenceCurrency(currency) ? value * 0.01 : value;
}


// IQR-based outlier smoothing + percentage-based V-shape detection
export function smoothOutliers(data) {
    if (!data || data.length < 10) return data;

    const prices = data.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < 10) return data;

    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - (1.5 * iqr);
    const upper = q3 + (1.5 * iqr);

    // Pass 1: IQR outliers
    let smoothed = data.map((point, i, arr) => {
        if (point.price < lower || point.price > upper) {
            const start = Math.max(0, i - 2);
            const end = Math.min(arr.length, i + 3);
            const neighborPrices = arr.slice(start, end).map(p => p.price).filter(p => p > 0).sort((a, b) => a - b);
            if (neighborPrices.length > 0) {
                const median = neighborPrices[Math.floor(neighborPrices.length / 2)];
                return { ...point, price: median };
            }
        }
        return point;
    });

    // Pass 2-4: Percentage-based V-shape detection (catches 25%+ single-point deviations)
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < smoothed.length - 1; i++) {
            const prev = smoothed[i - 1].price;
            const curr = smoothed[i].price;
            const next = smoothed[i + 1].price;

            if (prev > 0 && next > 0) {
                const diffPrev = Math.abs(curr - prev) / prev;
                const diffNext = Math.abs(curr - next) / next;
                // Catch spikes: >25% deviation from BOTH neighbors
                if (diffPrev > 0.25 && diffNext > 0.25) {
                    smoothed[i] = { ...smoothed[i], price: (prev + next) / 2 };
                }
            }
        }
    }

    return smoothed;
}


// Futures/Commodities searchable by name
const FUTURES_BY_NAME = {
    'GOLD': { symbol: 'GC=F', displaySymbol: 'GC', shortname: 'Gold', type: 'FUTURE' },
    'SILVER': { symbol: 'SI=F', displaySymbol: 'SI', shortname: 'Silver', type: 'FUTURE' },
    'COPPER': { symbol: 'HG=F', displaySymbol: 'HG', shortname: 'Copper', type: 'FUTURE' },
    'PLATINUM': { symbol: 'PL=F', displaySymbol: 'PL', shortname: 'Platinum', type: 'FUTURE' },
    'PALLADIUM': { symbol: 'PA=F', displaySymbol: 'PA', shortname: 'Palladium', type: 'FUTURE' },
    'CRUDE': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'Crude Oil', type: 'FUTURE' },
    'OIL': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'Crude Oil', type: 'FUTURE' },
    'WTI': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'WTI Crude Oil', type: 'FUTURE' },
    'BRENT': { symbol: 'BZ=F', displaySymbol: 'BZ', shortname: 'Brent Oil', type: 'FUTURE' },
    'NATURAL GAS': { symbol: 'NG=F', displaySymbol: 'NG', shortname: 'Natural Gas', type: 'FUTURE' },
    'GAS': { symbol: 'NG=F', displaySymbol: 'NG', shortname: 'Natural Gas', type: 'FUTURE' },
    'WHEAT': { symbol: 'ZW=F', displaySymbol: 'ZW', shortname: 'Wheat', type: 'FUTURE' },
    'CORN': { symbol: 'ZC=F', displaySymbol: 'ZC', shortname: 'Corn', type: 'FUTURE' },
    'SOYBEANS': { symbol: 'ZS=F', displaySymbol: 'ZS', shortname: 'Soybeans', type: 'FUTURE' },
    'SOY': { symbol: 'ZS=F', displaySymbol: 'ZS', shortname: 'Soybeans', type: 'FUTURE' },
    'COFFEE': { symbol: 'KC=F', displaySymbol: 'KC', shortname: 'Coffee', type: 'FUTURE' },
    'COTTON': { symbol: 'CT=F', displaySymbol: 'CT', shortname: 'Cotton', type: 'FUTURE' },
    'SUGAR': { symbol: 'SB=F', displaySymbol: 'SB', shortname: 'Sugar', type: 'FUTURE' },
    'COCOA': { symbol: 'CC=F', displaySymbol: 'CC', shortname: 'Cocoa', type: 'FUTURE' },
    'RUSSELL': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'RUSSELL 2000': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'RTY': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'SP500': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'S&P': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'S&P 500': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'ES': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'NASDAQ': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'NASDAQ 100': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'NQ': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'DOW': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'DOW JONES': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'YM': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'VIX': { symbol: 'VX=F', displaySymbol: 'VX', shortname: 'VIX', type: 'FUTURE' }
};


export function normalizeSearch(results, q) {
    // Filter for relevant types (Equity, Crypto, ETF, Currency)
    let filtered = (results.quotes || []).filter(item =>
        item.isYahooFinance &&
        (item.quoteType === 'EQUITY' || item.quoteType === 'CRYPTOCURRENCY' || item.quoteType === 'ETF' || item.quoteType === 'MUTUALFUND' || item.quoteType === 'CURRENCY' || item.quoteType === 'COMMODITY' || item.quoteType === 'FUTURE')
    ).map(item => {
        // Clean up symbol for display - remove =X suffix
        let displaySymbol = item.symbol;
        if (displaySymbol.endsWith('=X')) {
            displaySymbol = displaySymbol.replace('=X', '');
        }

        return {
            symbol: item.symbol, // Keep original symbol for API calls
            displaySymbol: displaySymbol, // Clean symbol for display
            shortname: item.shortname || item.longname || displaySymbol,
            type: item.quoteType,
            exchange: item.exchange,
            currency: item.currency
        };
    });

    // Special handling for 3-letter currency codes - always add at top
    const upperQ = q.toUpperCase().trim();
    const commonCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB'];

    if (commonCurrencies.includes(upperQ)) {
        // Remove any existing matching currency to avoid duplicates
        filtered = filtered.filter(r => r.symbol !== `${upperQ}=X`);

        // Always add the currency at the top
        filtered.unshift({
            symbol: `${upperQ}=X`,
            displaySymbol: upperQ,
            shortname: `${upperQ} Currency`,
            type: 'CURRENCY',
            exchange: 'CCY',
            currency: 'USD'
        });
    }

    // Special handling for futures/commodities by name (e.g., "russell" -> RTY=F)
    const futuresMatch = FUTURES_BY_NAME[upperQ];
    if (futuresMatch) {
        // Check if already in results
        const exists = filtered.some(r => r.symbol === futuresMatch.symbol);
        if (!exists) {
            filtered.unshift({
                symbol: futuresMatch.symbol,
                displaySymbol: futuresMatch.displaySymbol,
                shortname: futuresMatch.shortname,
                longname: futuresMatch.shortname,
                type: futuresMatch.type,
                exchange: 'CME',
                currency: 'USD'
            });
        }
    }

    // Special handling for crypto pairs without dash (e.g., ETHAUD -> ETH-AUD)
    // Check if query looks like a crypto pair (6+ chars, all letters, no dash)
    if (upperQ.length >= 6 && /^[A-Z]+$/.test(upperQ) && !upperQ.includes('-')) {
        // Try to split into base and quote (e.g., ETHAUD -> ETH + AUD)
        // Common crypto bases: BTC, ETH, SOL, ADA, DOT, etc. (3-4 chars)
        // Common quote currencies: USD, USDT, USDC, EUR, GBP, etc.
        const possibleBases = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'CRV', 'SUSHI', 'COMP', 'MKR', 'YFI', 'SNX', 'BAL', 'LRC', 'MATIC', 'AVAX', 'FTM', 'NEAR', 'ALGO', 'VET', 'FIL', 'XTZ', 'ATOM', 'LTC', 'BCH', 'XLM', 'XRP', 'DOGE', 'SHIB'];
        const possibleQuotes = ['USD', 'USDT', 'USDC', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB', 'IDR', 'BTC', 'ETH'];

        for (const base of possibleBases) {
            if (upperQ.startsWith(base)) {
                const quote = upperQ.substring(base.length);
                if (possibleQuotes.includes(quote)) {
                    const pairSymbol = `${base}-${quote}`;
                    // Check if this pair already exists in results
                    const exists = filtered.some(r =>
                        r.symbol === pairSymbol ||
                        r.symbol === `${base}${quote}=X` ||
                        r.symbol === `${base}-${quote}`
                    );

                    if (!exists) {
                        // Add the crypto pair at the top
                        filtered.unshift({
                            symbol: pairSymbol,
                            displaySymbol: pairSymbol,
                            shortname: `${base} ${quote}`,
                            longname: `${base} to ${quote}`,
                            type: 'CRYPTOCURRENCY',
                            exchange: 'CCC',
                            currency: quote
                        });
                    }
                    break;
                }
            }
        }
    }

    return filtered;
}

export function normalizeFinancials(quoteSummary) {
    // Extract and normalize data
    const data = {
        // Key Statistics
        keyStats: quoteSummary.defaultKeyStatistics ? {
            enterpriseValue: quoteSummary.defaultKeyStatistics.enterpriseValue,
            forwardPE: quoteSummary.defaultKeyStatistics.forwardPE,
            pegRatio: quoteSummary.defaultKeyStatistics.pegRatio,
            priceToBook: quoteSummary.defaultKeyStatistics.priceToBook,
            enterpriseToRevenue: quoteSummary.defaultKeyStatistics.enterpriseToRevenue,
            enterpriseToEbitda: quoteSummary.defaultKeyStatistics.enterpriseToEbitda,
            beta: quoteSummary.defaultKeyStatistics.beta,
            fiftyTwoWeekChange: quoteSummary.defaultKeyStatistics['52WeekChange'],
            sharesOutstanding: quoteSummary.defaultKeyStatistics.sharesOutstanding,
            sharesShort: quoteSummary.defaultKeyStatistics.sharesShort,
            shortRatio: quoteSummary.defaultKeyStatistics.shortRatio,
            bookValue: quoteSummary.defaultKeyStatistics.bookValue,
            heldPercentInsiders: quoteSummary.defaultKeyStatistics.heldPercentInsiders,
            heldPercentInstitutions: quoteSummary.defaultKeyStatistics.heldPercentInstitutions
        } : null,

        // Summary Details
        summaryDetail: quoteSummary.summaryDetail ? {
            marketCap: quoteSummary.summaryDetail.marketCap,
            trailingPE: quoteSummary.summaryDetail.trailingPE,
            forwardPE: quoteSummary.summaryDetail.forwardPE,
            dividendYield: quoteSummary.summaryDetail.dividendYield,
            dividendRate: quoteSummary.summaryDetail.dividendRate,
            exDividendDate: quoteSummary.summaryDetail.exDividendDate,
            payoutRatio: quoteSummary.summaryDetail.payoutRatio,
            fiftyDayAverage: quoteSummary.summaryDetail.fiftyDayAverage,
            twoHundredDayAverage: quoteSummary.summaryDetail.twoHundredDayAverage,
            volume: quoteSummary.summaryDetail.volume,
            averageVolume: quoteSummary.summaryDetail.averageVolume,
            fiftyTwoWeekHigh: quoteSummary.summaryDetail.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quoteSummary.summaryDetail.fiftyTwoWeekLow
        } : null,

        // Financial Data
        financialData: quoteSummary.financialData ? {
            currentPrice: quoteSummary.financialData.currentPrice,
            targetHighPrice: quoteSummary.financialData.targetHighPrice,
            targetLowPrice: quoteSummary.financialData.targetLowPrice,
            targetMeanPrice: quoteSummary.financialData.targetMeanPrice,
            recommendationKey: quoteSummary.financialData.recommendationKey,
            numberOfAnalystOpinions: quoteSummary.financialData.numberOfAnalystOpinions,
            totalRevenue: quoteSummary.financialData.totalRevenue,
            revenueGrowth: quoteSummary.financialData.revenueGrowth,
            grossMargins: quoteSummary.financialData.grossMargins,
            ebitdaMargins: quoteSummary.financialData.ebitdaMargins,
            operatingMargins: quoteSummary.financialData.operatingMargins,
            profitMargins: quoteSummary.financialData.profitMargins,
            returnOnAssets: quoteSummary.financialData.returnOnAssets,
            returnOnEquity: quoteSummary.financialData.returnOnEquity,
            totalCash: quoteSummary.financialData.totalCash,
            totalDebt: quoteSummary.financialData.totalDebt,
            debtToEquity: quoteSummary.financialData.debtToEquity,
            currentRatio: quoteSummary.financialData.currentRatio,
            freeCashflow: quoteSummary.financialData.freeCashflow
        } : null,

        // Calendar Events
        calendarEvents: quoteSummary.calendarEvents ? {
            earnings: quoteSummary.calendarEvents.earnings ? {
                earningsDate: quoteSummary.calendarEvents.earnings.earningsDate,
                earningsAverage: quoteSummary.calendarEvents.earnings.earningsAverage,
                earningsLow: quoteSummary.calendarEvents.earnings.earningsLow,
                earningsHigh: quoteSummary.calendarEvents.earnings.earningsHigh,
                revenueAverage: quoteSummary.calendarEvents.earnings.revenueAverage,
                revenueLow: quoteSummary.calendarEvents.earnings.revenueLow,
                revenueHigh: quoteSummary.calendarEvents.earnings.revenueHigh
            } : null,
            exDividendDate: quoteSummary.calendarEvents.exDividendDate,
            dividendDate: quoteSummary.calendarEvents.dividendDate
        } : null,

        // Earnings History (quarterly)
        earningsHistory: quoteSummary.earningsHistory?.history?.map(e => ({
            date: e.quarter,
            epsActual: e.epsActual,
            epsEstimate: e.epsEstimate,
            epsDifference: e.epsDifference,
            surprisePercent: e.surprisePercent
        })) || [],

        // Earnings Trend
        earningsTrend: quoteSummary.earningsTrend?.trend?.map(t => ({
            period: t.period,
            endDate: t.endDate,
            growth: t.growth,
            earningsEstimate: t.earningsEstimate ? {
                avg: t.earningsEstimate.avg,
                low: t.earningsEstimate.low,
                high: t.earningsEstimate.high,
                numberOfAnalysts: t.earningsEstimate.numberOfAnalysts
            } : null,
            revenueEstimate: t.revenueEstimate ? {
                avg: t.revenueEstimate.avg,
                low: t.revenueEstimate.low,
                high: t.revenueEstimate.high,
                numberOfAnalysts: t.revenueEstimate.numberOfAnalysts
            } : null
        })) || [],

        // Balance Sheet History (last 4 years)
        balanceSheet: quoteSummary.balanceSheetHistory?.balanceSheetStatements?.map(b => ({
            date: b.endDate,
            totalAssets: b.totalAssets,
            totalLiabilities: b.totalLiab,
            totalEquity: b.totalStockholderEquity,
            cash: b.cash,
            shortTermInvestments: b.shortTermInvestments,
            inventory: b.inventory,
            totalCurrentAssets: b.totalCurrentAssets,
            totalCurrentLiabilities: b.totalCurrentLiabilities,
            longTermDebt: b.longTermDebt,
            retainedEarnings: b.retainedEarnings
        })) || [],

        // Income Statement History
        incomeStatement: quoteSummary.incomeStatementHistory?.incomeStatementHistory?.map(i => ({
            date: i.endDate,
            totalRevenue: i.totalRevenue,
            costOfRevenue: i.costOfRevenue,
            grossProfit: i.grossProfit,
            operatingIncome: i.operatingIncome,
            netIncome: i.netIncome,
            ebit: i.ebit,
            interestExpense: i.interestExpense
        })) || [],

        // Cash Flow History
        cashFlow: quoteSummary.cashflowStatementHistory?.cashflowStatements?.map(c => ({
            date: c.endDate,
            operatingCashFlow: c.totalCashFromOperatingActivities,
            investingCashFlow: c.totalCashflowsFromInvestingActivities,
            financingCashFlow: c.totalCashFromFinancingActivities,
            capitalExpenditures: c.capitalExpenditures,
            freeCashFlow: c.freeCashFlow,
            dividendsPaid: c.dividendsPaid
        })) || []
    };

    return data;
}
