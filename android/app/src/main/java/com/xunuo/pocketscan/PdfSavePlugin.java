package com.xunuo.pocketscan;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "PdfSave")
public class PdfSavePlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String fileName = call.getString("fileName", "扫描文档.pdf");
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("PDF 数据为空");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            response.put("saved", false);
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }

        Uri destination = result.getData().getData();
        try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("无法打开选定的保存位置");
            output.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            output.flush();
            response.put("saved", true);
            response.put("cancelled", false);
            response.put("uri", destination.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("PDF 保存失败：" + error.getMessage(), error);
        }
    }
}
