# Group


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**external_id** | **str** | External group ID | 
**name** | **str** | Group name | [optional] 
**description** | **str** | Group description | [optional] 
**member_count** | **float** | Number of members | [optional] 
**created_at** | **datetime** | Creation timestamp | [optional] 
**created_by** | **str** | Creator ID | [optional] 
**is_read_only** | **bool** | Whether group is read-only | [optional] 
**platform_metadata** | **Dict[str, Optional[object]]** | Platform-specific metadata | [optional] 

## Example

```python
from omni_generated.models.group import Group

# TODO update the JSON string below
json = "{}"
# create an instance of Group from a JSON string
group_instance = Group.from_json(json)
# print the JSON string representation of the object
print(Group.to_json())

# convert the object into a dict
group_dict = group_instance.to_dict()
# create an instance of Group from a dict
group_from_dict = Group.from_dict(group_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


