# UserProfile


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**platform_user_id** | **str** | Platform user ID | 
**display_name** | **str** | Display name | [optional] 
**avatar_url** | **str** | Avatar URL | [optional] 
**bio** | **str** | Bio/status | [optional] 
**phone** | **str** | Phone number | [optional] 
**platform_metadata** | **Dict[str, Optional[object]]** | Platform-specific data | [optional] 

## Example

```python
from omni_generated.models.user_profile import UserProfile

# TODO update the JSON string below
json = "{}"
# create an instance of UserProfile from a JSON string
user_profile_instance = UserProfile.from_json(json)
# print the JSON string representation of the object
print(UserProfile.to_json())

# convert the object into a dict
user_profile_dict = user_profile_instance.to_dict()
# create an instance of UserProfile from a dict
user_profile_from_dict = UserProfile.from_dict(user_profile_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


