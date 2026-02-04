# BulkUpdateSettingsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**settings** | **Dict[str, Optional[object]]** | Key-value pairs | 
**reason** | **str** | Reason for changes (audit) | [optional] 

## Example

```python
from omni_generated.models.bulk_update_settings_request import BulkUpdateSettingsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of BulkUpdateSettingsRequest from a JSON string
bulk_update_settings_request_instance = BulkUpdateSettingsRequest.from_json(json)
# print the JSON string representation of the object
print(BulkUpdateSettingsRequest.to_json())

# convert the object into a dict
bulk_update_settings_request_dict = bulk_update_settings_request_instance.to_dict()
# create an instance of BulkUpdateSettingsRequest from a dict
bulk_update_settings_request_from_dict = BulkUpdateSettingsRequest.from_dict(bulk_update_settings_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


