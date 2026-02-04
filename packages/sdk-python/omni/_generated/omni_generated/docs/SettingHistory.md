# SettingHistory


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
from omni_generated.models.setting_history import SettingHistory

# TODO update the JSON string below
json = "{}"
# create an instance of SettingHistory from a JSON string
setting_history_instance = SettingHistory.from_json(json)
# print the JSON string representation of the object
print(SettingHistory.to_json())

# convert the object into a dict
setting_history_dict = setting_history_instance.to_dict()
# create an instance of SettingHistory from a dict
setting_history_from_dict = SettingHistory.from_dict(setting_history_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


