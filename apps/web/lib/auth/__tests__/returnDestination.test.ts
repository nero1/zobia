import { authReturnDestination } from '../returnDestination';
it('returns existing users directly and new users through onboarding',()=>{expect(authReturnDestination(true,'/t/my-story/2')).toBe('/t/my-story/2');expect(authReturnDestination(false,'/b/my-blog/post')).toBe('/onboarding?redirect=%2Fb%2Fmy-blog%2Fpost');expect(authReturnDestination(false)).toBe('/onboarding');});
it.each(['//evil.example','https://evil.example','/\\evil.example','/t/story?redirect=evil','/t/%2f%2fevil'])('rejects unsafe return destinations: %s',(path)=>{expect(authReturnDestination(true,path)).toBe('/home');});
