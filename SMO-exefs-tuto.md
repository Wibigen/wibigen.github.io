# How to do exefs mods on SMO?

## On Windows:
Install WSL ([link](https://learn.microsoft.com/en-us/windows/wsl/install)), and follow the Linux steps.

## On Mac:
Use container machine and follow the Linux steps.

## On Linux:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential unzip git
```
download the following file, and put it in the user root (`cd ~`) : [link](https://drive.google.com/file/d/1QI0TM8-x7w2IbWXPj7R4ml4SjlJ_tAPF/view) (the download command doesn’t work)
```bash
chmod +x ~/install-devkitpro-pacman
sudo ./install-devkitpro-pacman
```
```bash
sudo dkp-pacman -Sy
sudo dkp-pacman -S --noconfirm switch-dev
```
```bash
echo 'export DEVKITPRO=/opt/devkitpro' >> ~/.bashrc
echo 'export PATH=$DEVKITPRO/devkitA64/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```
```bash
git clone https://github.com/Fuzzy2319/SMO-Exlaunch-Base
```
(you can replace the URL by any other exlaunch base, especially if you would like to mod another game)

go into your exlaunch base folder (mind the uppercase letters)
```bash
cmake -B build -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain.cmake
cmake --build build
```

**Congratulations ! Your exefs base is now set up !**


## FAQ :
What's the name of the code I can edit ?
> it’s `main.cpp`

Where is the code located ?
> It depends on the exlaunch base, but it’s usually located in `src/` or in `src/program`

How should I build my code ?
> execute `make` in the root of your exlaunch base

Where can I find functions to hook ?
> use the online decompilation of the game if it exists ([link for SMO](https://github.com/MonsterDruide1/OdysseyDecomp)), or ghidra / IDA / any other decomp tool

Where are the built files located ?
> they are in `build/`

There are a lot of files there… Which one should I pick up ?
> you’ll only need `main.npdm`, and `subsdk9` (without any extension) (it might be `subsdk8`, 10, or any other number)


I have another question… Where can I find you ?
> you can contact me on Discord (@WibiDev, or on my [Discord Server](https://discord.gg/FeuV9MqEuA))
