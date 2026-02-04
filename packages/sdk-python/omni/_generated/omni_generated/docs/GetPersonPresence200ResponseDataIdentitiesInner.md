# GetPersonPresence200ResponseDataIdentitiesInner


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
from omni_generated.models.get_person_presence200_response_data_identities_inner import GetPersonPresence200ResponseDataIdentitiesInner

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonPresence200ResponseDataIdentitiesInner from a JSON string
get_person_presence200_response_data_identities_inner_instance = GetPersonPresence200ResponseDataIdentitiesInner.from_json(json)
# print the JSON string representation of the object
print(GetPersonPresence200ResponseDataIdentitiesInner.to_json())

# convert the object into a dict
get_person_presence200_response_data_identities_inner_dict = get_person_presence200_response_data_identities_inner_instance.to_dict()
# create an instance of GetPersonPresence200ResponseDataIdentitiesInner from a dict
get_person_presence200_response_data_identities_inner_from_dict = GetPersonPresence200ResponseDataIdentitiesInner.from_dict(get_person_presence200_response_data_identities_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


