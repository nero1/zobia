import {NextResponse} from 'next/server';
import {androidAppLinks} from '@/lib/auth/androidAppLinks';
export const dynamic='force-dynamic';
export function GET(){
 try{return NextResponse.json(androidAppLinks(process.env.ANDROID_APP_LINK_SHA256),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'Android signing fingerprints are not configured correctly'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
