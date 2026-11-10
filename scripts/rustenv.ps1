# Rust toolchain lives on E: only (no PATH/registry changes). Usage: . .\scripts\rustenv.ps1
$env:RUSTUP_HOME = "E:\tools\rust\rustup"
$env:CARGO_HOME = "E:\tools\rust\cargo"
$env:RUSTUP_TOOLCHAIN = "1.78.0-x86_64-pc-windows-gnu"
$env:PATH = "E:\tools\rust\cargo\bin;" + $env:PATH
