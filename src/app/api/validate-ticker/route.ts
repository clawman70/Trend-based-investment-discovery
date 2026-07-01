import { NextRequest, NextResponse } from 'next/server';
import { validateTickers } from '@/lib/tickerValidator';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolParam = searchParams.get('symbol');
    
    if (!symbolParam) {
      return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400 });
    }

    const symbols = symbolParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    
    if (symbols.length === 0) {
      return NextResponse.json({ error: 'Invalid symbol parameter' }, { status: 400 });
    }

    const result = await validateTickers(symbols);

    if (symbols.length === 1) {
      const singleSymbol = symbols[0];
      const isValid = result.valid.includes(singleSymbol);
      return NextResponse.json({ symbol: singleSymbol, valid: isValid, bypassed: result.bypassed });
    }

    return NextResponse.json({
      valid: result.valid,
      invalid: result.invalid,
      bypassed: result.bypassed
    });
  } catch (error: unknown) {
    console.error("Error in validate-ticker route:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
