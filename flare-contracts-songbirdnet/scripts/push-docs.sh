# This script generates an index file with links and descriptions for every
# user-facing contract, updates the mkdocs.yml file in the docs repository,
# and finally commits and pushes the changes to the docs repository.

cd docs/api/userInterfaces
sc_commit=$(git rev-parse --short HEAD)

# Temporarily clone the docs repo here
rm -rf docs-repo
git clone --depth 1 --single-branch --branch api-reference git@github.com:flare-foundation/docs-private.git docs-repo

# Generate index.md
echo "# API Reference Guide" > index.md
echo >> index.md
echo "List of public-facing smart contracts." >> index.md
echo >> index.md
echo "| Name | Description |" >> index.md
echo "| ---- | ----------- |" >> index.md
for f in $(ls *.md)
do
    # Skip index.md
    [[ $f = index.md ]] && continue
    name=$(echo $f | sed "s/\([^.]*\)\.md/[\1]\(\1.md\)/g")
    # Get the 3rd line of the contract md file, where the description lies.
    description=$(sed '3q;d' $f)
    # If the description starts with #, the contract has no description.
    [[ $description =~ ^#.* ]] && description=""
    echo "| $name | $description |" >> index.md
done

# Generate mkdocs.yml entries
# Keep everything below "Exchange guides"
sed -n '/- Exchange guides:/,$p' docs-repo/mkdocs.yml > docs-repo/mkdocs.yml.tmp2
# Remove all lines below "API reference"
sed '/- API reference:/,$d' docs-repo/mkdocs.yml > docs-repo/mkdocs.yml.tmp
# Now list all files
echo "      - API reference:" >> docs-repo/mkdocs.yml.tmp
echo "        - dev/reference/userInterfaces/index.md" >> docs-repo/mkdocs.yml.tmp
for f in $(ls *.md)
do
    [[ $f = index.md ]] && continue
    echo "        - dev/reference/userInterfaces/$f" >> docs-repo/mkdocs.yml.tmp
done
cat docs-repo/mkdocs.yml.tmp docs-repo/mkdocs.yml.tmp2 > docs-repo/mkdocs.yml

# Copy all pages to the docs repo
mkdir -p docs-repo/docs/dev/reference/userInterfaces
cp *.md docs-repo/docs/dev/reference/userInterfaces/

# Commit and push changes
# If there are no changes, nothing will be committed nor pushed.
cd docs-repo
git add docs/dev/reference/userInterfaces
git add mkdocs.yml
git commit -m "Sync API ref docs with commit $sc_commit"
git push
rm -rf docs-repo

cd ../../..
