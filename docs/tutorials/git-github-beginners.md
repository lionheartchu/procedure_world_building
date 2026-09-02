# Git and GitHub for Complete Beginners

This tutorial explains the basics of Git and GitHub in plain language. By the end, you should understand how to create a project, save versions of your work, and share it with others.

---

## 1. What is Git?

Git is a version control system. It tracks changes in your files and lets you go back to earlier versions when needed.

Think of it like this:

- You are writing a report.
- You save versions like `draft-v1`, `draft-v2`, `final`.
- Git does that automatically, but in a smarter and more organized way.

Git is useful for:

- keeping a history of your work
- undoing mistakes
- working with teammates
- collaborating on code

## 2. What is GitHub?

GitHub is a website where people store Git repositories online.

It is like a cloud-based home for your Git projects. GitHub makes it easier to:

- share code with others
- collaborate on projects
- review changes
- publish open-source work

Git and GitHub are related, but they are not the same thing:

- Git = the tool that tracks changes locally on your computer
- GitHub = the online platform that hosts repositories and helps teams collaborate

---

## 3. Installing Git

### On Windows

1. Download Git from https://git-scm.com/downloads
2. Run the installer
3. Keep the default options unless you know you need something else
4. Finish the install

### On macOS

You can install Git with Homebrew:

```bash
brew install git
```

If you do not have Homebrew, install it from https://brew.sh.

### On Linux

Use your package manager. For example:

```bash
sudo apt update
sudo apt install git
```

### Check if Git is installed

```bash
git --version
```

If it prints a version number, Git is installed correctly.

---

## 4. Configure Git

After installing Git, tell it your name and email. This information is saved with every commit.

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

You can check your config with:

```bash
git config --global --list
```

---

## 5. Create Your First Git Repository

A repository is a folder that Git tracks.

Create a new folder:

```bash
mkdir my-first-project
cd my-first-project
```

Initialize the repository:

```bash
git init
```

This creates a hidden folder named `.git`, which stores Git metadata.

---

## 6. Seeing the Status of Your Project

The most common Git command is:

```bash
git status
```

This shows:

- which files changed
- which files are staged
- whether your branch is clean

Example output:

```bash
On branch main

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
    hello.txt
```

`Untracked` means Git is not tracking that file yet.

---

## 7. Add a File and Commit It

Create a file:

```bash
echo "Hello, Git!" > hello.txt
```

Check status again:

```bash
git status
```

Now add the file to the staging area:

```bash
git add hello.txt
```

The staging area is where you prepare changes before saving them permanently.

Then commit the change:

```bash
git commit -m "Add hello file"
```

A commit is a saved snapshot of your project.

The message after `-m` should explain what changed.

Example:

```bash
git commit -m "Create first project file"
```

---

## 8. Understanding the Basic Git Workflow

The basic Git workflow is:

1. Modify files
2. Check status
3. Add files to staging
4. Commit changes

```bash
git status
git add .
git commit -m "Describe your change"
```

The `.` in `git add .` means: add all files in the current folder.

---

## 9. View History

To see all commits:

```bash
git log
```

This shows commit messages and IDs.

A very simple history may look like this:

```bash
commit a1b2c3d4...
Author: Your Name <you@example.com>
Date:   Wed Sep 2 12:00:00 2026

    Add hello file
```

---

## 10. Branches

A branch is a separate line of development.

Why use branches?

- try a new idea safely
- fix bugs without disturbing main work
- work on features in isolation

The default branch is usually called `main`.

Create a new branch:

```bash
git branch feature-idea
```

Switch to it:

```bash
git checkout feature-idea
```

A newer Git command is:

```bash
git switch -c feature-idea
```

This both creates and switches to the branch in one step.

To go back to `main`:

```bash
git switch main
```

---

## 11. Making Changes on a Branch

Create a new file or edit an existing one, then commit it:

```bash
echo "This is a feature branch change" >> notes.txt
git add notes.txt
git commit -m "Add notes for feature"
```

Now your feature branch has a different history than `main`.

---

## 12. Merging Branches

When your feature is ready, merge it back into `main`.

```bash
git switch main
git merge feature-idea
```

If there are no conflicts, the branch is merged successfully.

If Git finds conflicting edits in the same file, it will stop and ask you to resolve them manually.

---

## 13. GitHub: Create an Account

Go to https://github.com and create a free account.

Choose:

- a username you can share
- a strong password
- a valid email address

After creating the account, verify your email.

---

## 14. Create a Remote Repository on GitHub

On GitHub:

1. Click the green "New repository" button
2. Name your repository
3. Choose whether it is public or private
4. Do not initialize with a README if you already have a local repo
5. Click "Create repository"

GitHub will then show you commands such as:

```bash
git remote add origin https://github.com/USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

---

## 15. Connect Your Local Repo to GitHub

If your project already exists locally:

```bash
git remote add origin https://github.com/USERNAME/REPO_NAME.git
```

Then rename your branch to `main` if needed:

```bash
git branch -M main
```

Then push to GitHub:

```bash
git push -u origin main
```

The `-u` flag sets the upstream tracking branch. After that, future pushes are shorter:

```bash
git push
```

---

## 16. Clone a Repository from GitHub

To download someone else's project to your computer:

```bash
git clone https://github.com/USERNAME/REPO_NAME.git
```

This creates a local copy and automatically links it to the GitHub repository.

---

## 17. Pulling Changes

If you are working on a shared project, you may want to update your local copy with changes from GitHub:

```bash
git pull
```

This combines fetching remote changes and merging them into your current branch.

---

## 18. Ignore Files with .gitignore

Some files should not be committed, like temporary files or secrets.

Create a file named `.gitignore`:

```bash
# Ignore Python cache files
__pycache__/
*.pyc

# Ignore editor settings
.vscode/

# Ignore environment files
.env
```

Then add and commit it:

```bash
git add .gitignore
git commit -m "Add gitignore"
```

This keeps your repository cleaner and safer.

---

## 19. Common Git Terms

Here are the most important beginner terms:

- Repository: a project folder tracked by Git
- Commit: a saved version of your project
- Staging area: files ready to be committed
- Branch: a separate line of development
- Merge: combine changes from one branch into another
- Clone: download a repository from GitHub
- Push: upload local commits to GitHub
- Pull: download remote changes
- Remote: the online GitHub repository connected to your local project

---

## 20. Typical Beginner Workflow

A normal workflow for a beginner looks like this:

```bash
mkdir project
cd project
git init
echo "Hello world" > app.txt
git add app.txt
git commit -m "Create app file"
```

Then connect to GitHub:

```bash
git remote add origin https://github.com/USERNAME/project.git
git branch -M main
git push -u origin main
```

Later when you edit files:

```bash
git status
git add .
git commit -m "Update project"
git push
```

---

## 21. Best Practices

- Commit often, but only when a meaningful change is complete
- Write clear commit messages
- Do not commit secrets like API keys or passwords
- Use branches for features or bug fixes
- Pull before you push if you are working with others
- Keep your repository organized

---

## 22. Common Mistakes

### I forgot to stage a file

```bash
git add file_name
```

### I committed too early

You can fix this by changing files and making a new commit.

### I made a mistake and want to undo a commit

If the change was not pushed yet, you can reset it:

```bash
git reset --soft HEAD~1
```

This moves the branch back one commit while keeping your changes.

### I want to see what changed

```bash
git diff
```

This shows the difference between your current work and the last commit.

---

## 23. GitHub Workflow for Team Projects

This is how many projects work:

1. Create a branch
2. Make changes
3. Commit changes
4. Push the branch to GitHub
5. Open a pull request
6. Review and merge

A pull request is a request to merge your branch into another branch such as `main`.

---

## 24. Final Example: A Complete Beginner Flow

```bash
# 1. Create a folder
mkdir demo-app
cd demo-app

# 2. Start Git
git init

# 3. Create files
printf "My first project\n" > README.md

# 4. Track files
git add README.md

# 5. Save a version
git commit -m "Initial commit"

# 6. Connect to GitHub
# Replace with your own username and repo name
# git remote add origin https://github.com/USERNAME/demo-app.git

# 7. Push to GitHub
# git branch -M main
# git push -u origin main
```

---

## 25. Quick Reference Commands

```bash
git init
git status
git add <file>
git add .
git commit -m "message"
git log
git branch
git switch -c new-branch
git switch main
git merge branch-name
git remote add origin URL
git push -u origin main
git pull
git clone URL
```

---

## 26. Summary

Git helps you track changes in your project. GitHub helps you store that project online and collaborate with others.

The key idea is simple:

- create a repository
- make changes
- stage them
- commit them
- push to GitHub
- collaborate using branches and pull requests

If you practice these steps regularly, Git will become much easier over time.

---

## 27. Next Steps

Once you are comfortable with the basics, try these:

- create a branch for a feature
- merge a branch back into `main`
- use a `.gitignore` file
- fork a public repository on GitHub
- open a pull request on a project you like

You do not need to memorize everything at once. The best way to learn Git is to use it on a small project and make mistakes in a safe environment.

---

## 28. Helpful Resources

- https://git-scm.com/doc
- https://docs.github.com/en/get-started
- https://www.atlassian.com/git/tutorials

These sites are excellent for beginners who want to continue learning.
