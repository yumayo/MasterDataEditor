namespace App.MasterDataEditor;

internal interface IWebViewWindowController
{
	void BeginWindowDrag(double screenX, double screenY);
	void BeginWindowResize(string direction);
	void ShowSystemMenu(double screenX, double screenY);
	void MinimizeWindow();
	void ToggleMaximizeWindow();
	void CloseWindow();
	object CreateWindowStateChangedMessage();
}

internal sealed class NullWebViewWindowController : IWebViewWindowController
{
	public static readonly NullWebViewWindowController Instance = new();

	private NullWebViewWindowController()
	{
	}

	public void BeginWindowDrag(double screenX, double screenY)
	{
	}

	public void BeginWindowResize(string direction)
	{
	}

	public void ShowSystemMenu(double screenX, double screenY)
	{
	}

	public void MinimizeWindow()
	{
	}

	public void ToggleMaximizeWindow()
	{
	}

	public void CloseWindow()
	{
	}

	public object CreateWindowStateChangedMessage()
	{
		return new
		{
			type = "window_state_changed",
			isMaximized = false,
			title = ""
		};
	}
}
