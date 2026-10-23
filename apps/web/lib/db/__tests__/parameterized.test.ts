import {PgDialect} from 'drizzle-orm/pg-core';
import {bindSql} from '../parameterized';
const dialect=new PgDialect();
it('binds untrusted values without interpolating SQL syntax',()=>{
 const value="'; DROP TABLE users;--";
 const query=dialect.sqlToQuery(bindSql('SELECT * FROM users WHERE email=$2 OR username=$1 OR bio=$2',['name',value]));
 expect(query.sql).toBe('SELECT * FROM users WHERE email=$1 OR username=$2 OR bio=$3');
 expect(query.params).toEqual([value,'name',value]);
});
it('leaves placeholders inside literals, identifiers, comments and dollar quotes unchanged',()=>{
 const text=`SELECT '$1', "$2", $$literal $3$$, $tag$literal $4$tag$, $1 /* $8 /* $9 */ */ -- $7\n`;
 const query=dialect.sqlToQuery(bindSql(text,['bound']));
 expect(query.params).toEqual(['bound']);expect(query.sql).toBe(text);
});
it('rejects an absent parameter instead of binding undefined',()=>expect(()=>bindSql('SELECT $2',['one'])).toThrow('SQL parameter missing'));
