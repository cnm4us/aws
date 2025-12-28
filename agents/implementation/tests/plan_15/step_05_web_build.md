### $(date -Is)
- Command: `npm run web:build`
- Result: success

```
$(npm run -s web:build | sed -e 's/\x1b\[[0-9;]*m//g')
```

### Bundle sanity
- Command: `rg -n "AdminSpaceDetail|AdminSpaceCreate|AdminSpaces" public/app/assets -S`
- Expected: no matches
- Result:

```
$(rg -n "AdminSpaceDetail|AdminSpaceCreate|AdminSpaces" public/app/assets -S || true)
```
