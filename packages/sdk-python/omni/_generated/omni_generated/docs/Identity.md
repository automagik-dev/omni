# Identity


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Identity UUID | 
**person_id** | **UUID** | Person UUID | 
**channel** | **str** | Channel type | 
**platform_user_id** | **str** | Platform user ID | 
**display_name** | **str** | Display name | 
**profile_pic_url** | **str** | Profile picture URL | 
**message_count** | **int** | Total messages | 
**last_seen_at** | **datetime** | Last seen timestamp | 

## Example

```python
from omni_generated.models.identity import Identity

# TODO update the JSON string below
json = "{}"
# create an instance of Identity from a JSON string
identity_instance = Identity.from_json(json)
# print the JSON string representation of the object
print(Identity.to_json())

# convert the object into a dict
identity_dict = identity_instance.to_dict()
# create an instance of Identity from a dict
identity_from_dict = Identity.from_dict(identity_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


