import {NextResponse} from 'next/server';
/** Cheap process liveness; dependency readiness remains /api/health. */
export function GET(){return NextResponse.json({status:'alive'},{headers:{'Cache-Control':'public, max-age=10, s-maxage=30'}});}
