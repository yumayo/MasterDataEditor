using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace App.MasterDataEditor;

/// <summary>
/// Win32 の各階層を no-follow で開き、操作が終わるまで書込み・名前変更を禁止する。
/// 検査済みの文字列を返すだけでは防げない reparse point 差し替えをここで閉じ込める。
/// </summary>
internal sealed class WorkspaceFileAccess : IDisposable
{
	private const uint ReadAttributes = 0x80;
	private const uint GenericRead = 0x80000000;
	private const uint GenericWrite = 0x40000000;
	private const uint DeleteAccess = 0x10000;
	private const uint OpenExisting = 3;
	private const uint OpenAlways = 4;
	private const uint OpenReparsePoint = 0x00200000;
	private const uint BackupSemantics = 0x02000000;
	private readonly List<SafeFileHandle> handles;
	private readonly string fullPath;

	private WorkspaceFileAccess(List<SafeFileHandle> handles, string fullPath)
	{
		this.handles = handles;
		this.fullPath = fullPath;
	}

	public static string ReadAllText(string baseDirectory, string relativePath) => ReadAllText(baseDirectory, relativePath, false) ?? "";
	public static void WriteAllText(string baseDirectory, string relativePath, string contents) => WriteAllText(baseDirectory, relativePath, contents, false);
	public static bool DeleteFile(string baseDirectory, string relativePath) => DeleteFile(baseDirectory, relativePath, false);

	// 保存先を固定したネイティブ専用入口。WebViewの要求から保護を解除する引数は渡せない。
	internal static string? ReadNativeTrustRecord(string filename) => ReadAllText(AppEnvironment.GetNativeTrustDirectory(), filename, true);
	internal static void WriteNativeTrustRecord(string filename, string contents) => WriteAllText(AppEnvironment.GetNativeTrustDirectory(), filename, contents, true);
	internal static bool DeleteNativeTrustRecord(string filename) => DeleteFile(AppEnvironment.GetNativeTrustDirectory(), filename, true);

	private static string? ReadAllText(string baseDirectory, string relativePath, bool nativeTrust)
	{
		try
		{
			using var access = LockParent(baseDirectory, relativePath, false, nativeTrust);
			using var handle = OpenFile(access.fullPath, GenericRead, OpenExisting, nativeTrust);
			using var stream = new FileStream(handle, FileAccess.Read);
			using var reader = new StreamReader(stream);
			return reader.ReadToEnd();
		}
		catch (FileNotFoundException) { return null; }
		catch (DirectoryNotFoundException) { return null; }
	}

	private static void WriteAllText(string baseDirectory, string relativePath, string contents, bool nativeTrust)
	{
		using var access = LockParent(baseDirectory, relativePath, true, nativeTrust);
		// OPEN_ALWAYS は検査前に既存内容を切り詰めない。検査した同じ handle にだけ書く。
		using var handle = OpenFile(access.fullPath, GenericWrite, OpenAlways, nativeTrust);
		using var stream = new FileStream(handle, FileAccess.Write);
		stream.SetLength(0);
		using var writer = new StreamWriter(stream);
		writer.Write(contents);
	}

	private static bool DeleteFile(string baseDirectory, string relativePath, bool nativeTrust)
	{
		try
		{
			using var access = LockParent(baseDirectory, relativePath, false, nativeTrust);
			using var handle = OpenFile(access.fullPath, DeleteAccess | ReadAttributes, OpenExisting, nativeTrust);
			// 検査後のパスを DeleteFile に再解決させず、検査した実体を削除する。
			var disposition = new FileDisposition { DeleteFile = true };
			if (!SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf<FileDisposition>())) throw NativeError(access.fullPath);
			return true;
		}
		catch (FileNotFoundException) { return false; }
		catch (DirectoryNotFoundException) { return false; }
	}

	public static List<object> FindEntries(string baseDirectory, string relativePath)
	{
		var path = HelperFile.ResolveSafePath(baseDirectory, relativePath) ?? throw new UnauthorizedAccessException("Invalid directory or linked path");
		RejectNativeTrustPath(path);
		try
		{
			using var access = LockDirectory(path, false, false);
			var entries = new DirectoryInfo(path).EnumerateFileSystemInfos().ToArray();
			var directories = new List<object>();
			var files = new List<object>();
			foreach (var entry in entries)
			{
				// 列挙時に取得した属性を使用し、リンク先の属性・サイズを取り直さない。
				if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
				if ((entry.Attributes & FileAttributes.Directory) != 0) directories.Add(new { name = entry.Name, type = "directory" });
				else files.Add(new { name = entry.Name, type = "file", size = ((FileInfo)entry).Length });
			}
			directories.AddRange(files);
			return directories;
		}
		catch (FileNotFoundException) { return new List<object>(); }
		catch (DirectoryNotFoundException) { return new List<object>(); }
	}

	public static WorkspaceFileAccess LockParent(string baseDirectory, string relativePath, bool createParents) => LockParent(baseDirectory, relativePath, createParents, false);

	private static WorkspaceFileAccess LockParent(string baseDirectory, string relativePath, bool createParents, bool nativeTrust)
	{
		var path = HelperFile.ResolveSafePath(baseDirectory, relativePath) ?? throw new UnauthorizedAccessException("Invalid filename or linked path");
		if (!nativeTrust) RejectNativeTrustPath(path);
		var parent = Path.GetDirectoryName(path) ?? throw new ArgumentException("Invalid file parent");
		var access = LockDirectory(parent, createParents, nativeTrust);
		try
		{
			// 保護ディレクトリの未作成時も、短縮名で辿った親の下に同名ファイルを作らせない。
			if (!nativeTrust && string.Equals(Path.GetFileName(path), "trusted-workspaces", StringComparison.OrdinalIgnoreCase))
			{
				if (!GetFileInformationByHandle(access.handles[^1], out var parentInformation)) throw NativeError(parent);
				if (MatchesFileIdentity(parentInformation, Path.GetDirectoryName(AppEnvironment.GetNativeTrustDirectory())!)) throw new UnauthorizedAccessException("Native workspace trust storage is reserved.");
			}
			return new WorkspaceFileAccess(access.handles, path);
		}
		catch { access.Dispose(); throw; }
	}

	public void ValidateGitFile(bool keepOpen)
	{
		try
		{
			var handle = OpenFile(fullPath, GenericRead, OpenExisting, false);
			if (keepOpen) handles.Add(handle);
			else handle.Dispose();
		}
		catch (FileNotFoundException) { }
	}

	public void Dispose()
	{
		for (var index = handles.Count - 1; index >= 0; index--) handles[index].Dispose();
		handles.Clear();
	}

	private static WorkspaceFileAccess LockDirectory(string path, bool create, bool nativeTrust)
	{
		if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Secure workspace file access requires Windows.");
		var root = Path.GetPathRoot(path) ?? throw new ArgumentException("Invalid path root");
		// UNC/device namespace は別の名前解決規則を持つため、ローカルドライブだけを扱う。
		if (root.Length != 3 || root[1] != ':' || root[2] != '\\') throw new UnauthorizedAccessException("Only local drive paths are supported.");
		var opened = new List<SafeFileHandle>();
		try
		{
			var current = root;
			var paths = new List<string> { root };
			foreach (var component in path.Substring(root.Length).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
			{
				if (!HelperFile.IsValidFilename(component)) throw new UnauthorizedAccessException("Invalid directory component");
				current = Path.Combine(current, component);
				paths.Add(current);
			}
			foreach (var directory in paths)
			{
				var handle = CreateFile(directory, ReadAttributes, FileShare.Read, IntPtr.Zero, OpenExisting, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
				if (handle.IsInvalid)
				{
					var error = Marshal.GetLastWin32Error();
					handle.Dispose();
					if (!create || (error != 2 && error != 3)) throw NativeError(directory, error);
					// 親を固定してから一階層だけ作成する。作成競合でリンクになっても次の open で拒否する。
					Directory.CreateDirectory(directory);
					handle = CreateFile(directory, ReadAttributes, FileShare.Read, IntPtr.Zero, OpenExisting, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
				}
				opened.Add(handle);
				if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var information)) throw NativeError(directory);
				if ((information.Attributes & (uint)FileAttributes.ReparsePoint) != 0 || (information.Attributes & (uint)FileAttributes.Directory) == 0)
					throw new UnauthorizedAccessException("Linked or non-directory parent is not allowed: " + directory);
				// 文字列が異なる8.3短縮名も、開いた各祖先の実体で保存領域への到達を拒否する。
				if (!nativeTrust && MatchesFileIdentity(information, AppEnvironment.GetNativeTrustDirectory())) throw new UnauthorizedAccessException("Native workspace trust storage is reserved.");
			}
			return new WorkspaceFileAccess(opened, path);
		}
		catch
		{
			foreach (var handle in opened) handle.Dispose();
			throw;
		}
	}

	private static SafeFileHandle OpenFile(string path, uint access, uint disposition, bool nativeTrust)
	{
		var handle = CreateFile(path, access, FileShare.Read, IntPtr.Zero, disposition, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
		try
		{
			if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var information)) throw NativeError(path);
			if (!nativeTrust && MatchesFileIdentity(information, AppEnvironment.GetNativeTrustDirectory())) throw new UnauthorizedAccessException("Native workspace trust storage is reserved.");
			if ((information.Attributes & (uint)(FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new UnauthorizedAccessException("Linked or non-file target is not allowed: " + path);
			// ハードリンク先を通じた作業フォルダー外への読取り・書込みも許可しない。
			if (information.NumberOfLinks != 1) throw new UnauthorizedAccessException("Hard-linked files are not allowed: " + path);
			return handle;
		}
		catch { handle.Dispose(); throw; }
	}

	private static void RejectNativeTrustPath(string path)
	{
		var protectedDirectory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(AppEnvironment.GetNativeTrustDirectory()));
		var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
		if (string.Equals(path, protectedDirectory, comparison) || path.StartsWith(protectedDirectory + Path.DirectorySeparatorChar, comparison)) throw new UnauthorizedAccessException("Native workspace trust storage is reserved.");
	}

	private static bool MatchesFileIdentity(FileInformation information, string protectedPath)
	{
		using var handle = CreateFile(protectedPath, ReadAttributes, FileShare.Read, IntPtr.Zero, OpenExisting, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
		if (handle.IsInvalid)
		{
			var error = Marshal.GetLastWin32Error();
			if (error == 2 || error == 3) return false;
			throw NativeError(protectedPath, error);
		}
		if (!GetFileInformationByHandle(handle, out var target)) throw NativeError(protectedPath);
		return information.VolumeSerialNumber == target.VolumeSerialNumber && information.FileIndexHigh == target.FileIndexHigh && information.FileIndexLow == target.FileIndexLow;
	}

	private static Exception NativeError(string path) => NativeError(path, Marshal.GetLastWin32Error());
	private static Exception NativeError(string path, int error)
	{
		if (error == 2) return new FileNotFoundException("File not found", path);
		if (error == 3) return new DirectoryNotFoundException("Directory not found: " + path);
		return new IOException("Secure file access failed: " + path, new Win32Exception(error));
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct FileInformation
	{
		public uint Attributes;
		public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
		public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
		public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
		public uint VolumeSerialNumber;
		public uint FileSizeHigh;
		public uint FileSizeLow;
		public uint NumberOfLinks;
		public uint FileIndexHigh;
		public uint FileIndexLow;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct FileDisposition { [MarshalAs(UnmanagedType.U1)] public bool DeleteFile; }

	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
	private static extern SafeFileHandle CreateFile(string filename, uint access, FileShare share, IntPtr security, uint creation, uint flags, IntPtr template);
	[DllImport("kernel32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
	[DllImport("kernel32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool SetFileInformationByHandle(SafeFileHandle file, int informationClass, ref FileDisposition information, uint size);
}
