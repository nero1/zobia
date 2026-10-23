/** Same-origin paths only; new accounts complete onboarding before returning to content. */
export function authReturnDestination(onboarded:boolean,requested?:string|null){
 const path=requested&&/^\/[a-zA-Z0-9/_-]*$/.test(requested)&&!requested.startsWith('//')?requested:'/home';
 return onboarded?path:path==='/home'?'/onboarding':`/onboarding?redirect=${encodeURIComponent(path)}`;
}
