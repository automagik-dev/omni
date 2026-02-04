# GetPersonPresence200ResponseDataSummary


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_messages** | **int** |  | 
**channels** | **List[str]** |  | 
**last_seen_at** | **datetime** |  | 

## Example

```python
from omni_generated.models.get_person_presence200_response_data_summary import GetPersonPresence200ResponseDataSummary

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonPresence200ResponseDataSummary from a JSON string
get_person_presence200_response_data_summary_instance = GetPersonPresence200ResponseDataSummary.from_json(json)
# print the JSON string representation of the object
print(GetPersonPresence200ResponseDataSummary.to_json())

# convert the object into a dict
get_person_presence200_response_data_summary_dict = get_person_presence200_response_data_summary_instance.to_dict()
# create an instance of GetPersonPresence200ResponseDataSummary from a dict
get_person_presence200_response_data_summary_from_dict = GetPersonPresence200ResponseDataSummary.from_dict(get_person_presence200_response_data_summary_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


