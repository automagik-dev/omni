# GetSettingHistory200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**old_value** | **str** | Old value (masked) | 
**new_value** | **str** | New value (masked) | 
**changed_by** | **str** | Who made the change | 
**changed_at** | **datetime** | When changed | 
**change_reason** | **str** | Reason for change | 

## Example

```python
from omni_generated.models.get_setting_history200_response_items_inner import GetSettingHistory200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of GetSettingHistory200ResponseItemsInner from a JSON string
get_setting_history200_response_items_inner_instance = GetSettingHistory200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(GetSettingHistory200ResponseItemsInner.to_json())

# convert the object into a dict
get_setting_history200_response_items_inner_dict = get_setting_history200_response_items_inner_instance.to_dict()
# create an instance of GetSettingHistory200ResponseItemsInner from a dict
get_setting_history200_response_items_inner_from_dict = GetSettingHistory200ResponseItemsInner.from_dict(get_setting_history200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


