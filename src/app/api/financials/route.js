import { yahooApiCall } from '@/utils/yahooHelper';
import { shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        // Fetch comprehensive financial data with rate-limit evasion
        let quoteSummary;
        try {
            quoteSummary = await yahooApiCall(
                (instance) => instance.quoteSummary(symbol, {
                    modules: [
                        'summaryDetail',
                        'defaultKeyStatistics',
                        'financialData',
                        'calendarEvents',
                        'earnings',
                        'earningsHistory',
                        'earningsTrend',
                        'incomeStatementHistory',
                        'balanceSheetHistory',
                        'cashflowStatementHistory'
                    ]
                }),
                [],
                { maxRetries: 3 }
            );
        } catch (e) {
            quoteSummary = null;
        }

        if (!quoteSummary) {
            return NextResponse.json({ error: 'No financial data available' }, { status: 404 });
        }

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

        // Cache control: Long cache (24h) for financial statements
        const response = NextResponse.json({ data, source: 'yahoo-finance2' });
        response.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

        return response;
    } catch (error) {
        console.error('Financial data error:', error);

        // Return more descriptive error for rate limiting
        if (shouldUseFallback(error)) {
            return NextResponse.json({
                error: 'Rate limited by Yahoo Finance. Please try again in a few minutes.',
                retryAfter: 60
            }, { status: 429 });
        }

        return NextResponse.json({ error: 'Failed to fetch financial data' }, { status: 500 });
    }
}
